using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Daymark;

public sealed class LocalServer(Tracker tracker) : IDisposable
{
    private readonly HttpListener listener = new();
    private static readonly Dictionary<string, string> Assets = new() { ["/"] = "index.html", ["/style.css"] = "style.css", ["/app.js"] = "app.js", ["/analytics.mjs"] = "analytics.mjs", ["/demo.mjs"] = "demo.mjs", ["/ai.mjs"] = "ai.mjs" };
    public void Start()
    {
        listener.Prefixes.Add($"http://127.0.0.1:{tracker.ListenPort}/");
        listener.Start(); _ = Accept();
    }
    private async Task Accept()
    {
        while (listener.IsListening)
        {
            try { var context = await listener.GetContextAsync(); _ = Handle(context); }
            catch (Exception ex) when (ex is HttpListenerException or ObjectDisposedException) { break; }
        }
    }
    private async Task Handle(HttpListenerContext c)
    {
        try
        {
            var r = c.Request; var response = c.Response;
            response.Headers["Cache-Control"] = "no-store";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            response.Headers["Referrer-Policy"] = "no-referrer";
            response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
            if (r.Url?.Host != "127.0.0.1" || r.RemoteEndPoint == null || !IPAddress.IsLoopback(r.RemoteEndPoint.Address)) { response.StatusCode = 403; return; }
            var origin = r.Headers["Origin"];
            var extension = origin?.StartsWith("chrome-extension://", StringComparison.Ordinal) == true;
            if (origin != null && origin != $"http://127.0.0.1:{tracker.ListenPort}" && !extension) { response.StatusCode = 403; return; }
            if (extension) response.Headers["Access-Control-Allow-Origin"] = origin;
            if (r.HttpMethod == "OPTIONS")
            {
                response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
                response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                response.StatusCode = 204; return;
            }
            var path = r.Url.AbsolutePath;
            if (Assets.TryGetValue(path, out var asset) && r.HttpMethod == "GET")
            {
                response.ContentType = asset.EndsWith("css") ? "text/css; charset=utf-8" : asset.EndsWith("js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
                using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Daymark.Web." + asset)!;
                await stream.CopyToAsync(response.OutputStream); return;
            }
            var token = r.Headers["Authorization"]?.Replace("Bearer ", "", StringComparison.Ordinal) ?? "";
            bool ui = TokenMatches(token, tracker.Settings.Current.UiToken);
            bool browser = TokenMatches(token, tracker.Settings.Current.BrowserToken);
            bool integration = TokenMatches(token, tracker.Settings.Current.IntegrationToken);
            if (!ui && !(browser && path is "/api/browser" or "/api/browser/config" or "/api/ai") && !(integration && path == "/api/ai")) { response.StatusCode = 401; await Json(response, new { error = "Open the dashboard from the Daymark tray icon, or pair your browser extension." }); return; }
            if (path == "/api/status" && r.HttpMethod == "GET") await Json(response, tracker.Status());
            else if (path == "/api/settings" && r.HttpMethod == "GET") await Json(response, new { settings = PublicSettings(), startup = tracker.StartupEnabled, browserToken = tracker.Settings.Current.BrowserToken });
            else if (path == "/api/settings" && r.HttpMethod == "POST")
            {
                var body = await ReadBody<SettingsRequest>(r);
                tracker.UpdateSettings(body.Settings, body.Startup); await Json(response, new { ok = true });
            }
            else if ((path == "/api/segments" || path == "/api/ai-events") && r.HttpMethod == "GET")
            {
                if (!long.TryParse(r.QueryString["start"], out var start) || !long.TryParse(r.QueryString["end"], out var end) || start < 0 || end <= start || end - start > 94L * 86_400_000) throw new ArgumentException("Choose a time range of up to 93 days.");
                if(path == "/api/segments") await Json(response, tracker.Database.Read(start, end));
                else await Json(response, tracker.Database.ReadAi(start,end));
            }
            else if (path == "/api/pause" && r.HttpMethod == "POST") { tracker.SetPaused((await ReadBody<PauseRequest>(r)).Paused); await Json(response, tracker.Status()); }
            else if (path == "/api/browser/config" && r.HttpMethod == "GET") await Json(response, new { sites = tracker.Settings.Current.Sites, aiWebEnabled = tracker.Settings.Current.AiTrackingEnabled && tracker.Settings.Current.AiWebEnabled });
            else if (path == "/api/browser" && r.HttpMethod == "POST") { tracker.Receive(await ReadBody<BrowserPulse>(r)); await Json(response, new { ok = true }); }
            else if (path == "/api/ai" && r.HttpMethod == "POST") { tracker.ReceiveAi(await ReadBody<AiSignal>(r), browser); await Json(response, new { ok = true }); }
            else if (path == "/api/clear" && r.HttpMethod == "POST")
            {
                if ((await ReadBody<ClearRequest>(r)).Confirmation != "DELETE") throw new ArgumentException("Type DELETE to erase history.");
                tracker.ClearData(); await Json(response, new { ok = true });
            }
            else { response.StatusCode = 404; await Json(response, new { error = "Not found" }); }
        }
        catch (Exception ex) when (ex is ArgumentException or JsonException or InvalidDataException)
        { c.Response.StatusCode = 400; await Json(c.Response, new { error = ex.Message }); }
        catch (Exception ex)
        { tracker.Log(ex); try { c.Response.StatusCode = 500; await Json(c.Response, new { error = "Something went wrong. Check the local errors.log." }); } catch { } }
        finally { c.Response.Close(); }
    }
    private object PublicSettings() => new { tracker.Settings.Current.IdleMinutes, tracker.Settings.Current.MediaKeepsActive, tracker.Settings.Current.Apps, tracker.Settings.Current.Sites, tracker.Settings.Current.CaptureTitleApps, tracker.Settings.Current.AiTrackingEnabled, tracker.Settings.Current.AiWebEnabled };
    private static bool TokenMatches(string a, string b) => a.Length == b.Length && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    private static async Task<T> ReadBody<T>(HttpListenerRequest request)
    {
        if (request.ContentLength64 > 131072) throw new InvalidDataException("Request too large.");
        using var memory = new MemoryStream();
        var buffer = new byte[8192]; int read;
        while ((read = await request.InputStream.ReadAsync(buffer)) > 0)
        {
            if (memory.Length + read > 131072) throw new InvalidDataException("Request too large.");
            memory.Write(buffer, 0, read);
        }
        return JsonSerializer.Deserialize<T>(memory.ToArray(), Settings.Json) ?? throw new ArgumentException("Missing request body.");
    }
    private static async Task Json(HttpListenerResponse response, object value)
    {
        response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(response.OutputStream, value, Settings.Json);
    }
    public void Dispose() { listener.Close(); }
    private record SettingsRequest(Settings Settings, bool Startup);
    private record PauseRequest(bool Paused);
    private record ClearRequest(string Confirmation);
}
