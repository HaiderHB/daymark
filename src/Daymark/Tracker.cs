using Microsoft.Win32;

namespace Daymark;

public sealed class Tracker : IDisposable
{
    public const int Port = 43127;
    private readonly object gate = new();
    private readonly WindowsProbe probe = new();
    private readonly Collector collector;
    private readonly System.Threading.Timer timer;
    private readonly Dictionary<string, (BrowserPulse Pulse, long At)> browser = [];
    private bool locked;
    private bool paused;
    public SettingsStore Settings { get; }
    public Database Database { get; }
    public string DirectoryPath { get; }
    public int ListenPort { get; }
    public bool StartupEnabled => ListenPort == Port && Startup.Enabled;
    public bool Paused { get { lock (gate) return paused; } }
    public event Action? StateChanged;
    public Tracker(string directory, int port, bool noTrack)
    {
        DirectoryPath = directory; ListenPort = port; paused = noTrack;
        Settings = new(directory); Database = new(directory); collector = new(Database);
        Database.ResetAi(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        SystemEvents.SessionSwitch += SessionSwitch;
        SystemEvents.PowerModeChanged += PowerChanged;
        timer = new(_ => Tick(), null, Timeout.Infinite, Timeout.Infinite);
    }
    public async Task StartAsync()
    {
        await probe.InitializeAsync();
        Tick(); timer.Change(5000, 5000);
    }
    private void SessionSwitch(object sender, SessionSwitchEventArgs e)
    {
        lock (gate)
        {
            if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect) locked = true;
            if (e.Reason is SessionSwitchReason.SessionUnlock or SessionSwitchReason.ConsoleConnect or SessionSwitchReason.RemoteConnect) locked = false;
            Tick();
        }
    }
    private void PowerChanged(object sender, PowerModeChangedEventArgs e)
    {
        lock (gate)
        {
            if (e.Mode == PowerModes.Suspend) { Tick(); Database.ResetAi(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); timer.Change(Timeout.Infinite, Timeout.Infinite); }
            if (e.Mode == PowerModes.Resume) { Tick(); timer.Change(5000, 5000); }
        }
    }
    private void Tick()
    {
        lock (gate)
        {
            if (paused) return;
            try
            {
                var o = probe.Read(locked, Settings.Current.CaptureTitleApps);
                if (browser.TryGetValue(o.App, out var value) && o.At - value.At < 16_000 && value.Pulse.Focused)
                    o = o with { Domain = Settings.Current.AllowedDomain(o.App, value.Pulse.Domain), Media = o.Media || value.Pulse.Playing };
                collector.Sample(o, Settings.Current);
            }
            catch (Exception ex) { Log(ex); }
        }
    }
    public void Receive(BrowserPulse pulse)
    {
        lock (gate)
        {
            if (!Daymark.Settings.Browsers.Contains(pulse.Browser)) throw new ArgumentException("Unsupported browser.");
            // Drop unknown hosts at ingress, before they can reach the database.
            var allowed = Settings.Current.AllowedDomain(pulse.Browser, Daymark.Settings.NormalizeDomain(pulse.Domain));
            browser[pulse.Browser] = (pulse with { Domain = allowed, Playing = allowed != null && pulse.Playing }, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
    }
    public void SetPaused(bool value)
    {
        lock (gate) { Tick(); paused = value; collector.Reset(); Database.ResetAi(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); if (!paused) Tick(); }
        StateChanged?.Invoke();
    }
    public object Status()
    {
        lock (gate) return new { paused, kind = paused ? "paused" : collector.Kind, app = collector.App, startup = StartupEnabled, version = "0.1.0", browserConnected = browser.Any(p => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - p.Value.At < 20_000) };
    }
    public void UpdateSettings(Settings settings, bool startup)
    {
        lock (gate)
        {
            settings.UiToken = Settings.Current.UiToken;
            settings.BrowserToken = Settings.Current.BrowserToken;
            settings.IntegrationToken = Settings.Current.IntegrationToken;
            settings.Validate();
            if (!settings.AiTrackingEnabled || !settings.AiWebEnabled) Database.ResetAi(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            if (ListenPort == Port) Startup.Enabled = startup;
            Settings.Save(settings);
            browser.Clear();
        }
    }
    public void ReceiveAi(AiSignal signal, bool fromBrowser)
    {
        lock (gate)
        {
            if (paused || !Settings.Current.AiTrackingEnabled || (fromBrowser && !Settings.Current.AiWebEnabled)) return;
            if (!(fromBrowser ? new[] { "claude-web", "chatgpt-web" } : new[] { "claude-code", "codex" }).Contains(signal.Provider)) throw new ArgumentException("Unsupported AI provider.");
            if (signal.State is not ("running" or "waiting" or "idle" or "unknown") || string.IsNullOrWhiteSpace(signal.Session) || signal.Session.Length > 128 || signal.Project?.Length > 100) throw new ArgumentException("Invalid AI signal.");
            Database.AddAi(new(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), signal.Provider, signal.Session, signal.Project, signal.State, fromBrowser ? "web-ui" : "hook"));
        }
    }
    public void ClearData() { lock (gate) { collector.Reset(); Database.Delete(0, long.MaxValue); Database.ClearAi(); } }
    public void OpenDashboard() => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo($"http://127.0.0.1:{ListenPort}/#token={Settings.Current.UiToken}") { UseShellExecute = true });
    public void Log(Exception ex)
    {
        try
        {
            var path = Path.Combine(DirectoryPath, "errors.log");
            if (File.Exists(path) && new FileInfo(path).Length > 512_000) File.WriteAllText(path, "");
            File.AppendAllText(path, $"{DateTimeOffset.UtcNow:O} {ex.GetType().Name}: {ex.Message}\n");
        }
        catch { }
    }
    public void Dispose()
    {
        timer.Dispose();
        lock (gate) { Tick(); paused = true; Database.ResetAi(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()); Database.Dispose(); }
        SystemEvents.SessionSwitch -= SessionSwitch; SystemEvents.PowerModeChanged -= PowerChanged;
    }
}

internal static class Startup
{
    private const string PathName = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static bool Enabled
    {
        get { using var key = Registry.CurrentUser.OpenSubKey(PathName); return key?.GetValue("Daymark") != null; }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(PathName);
            if (value) key.SetValue("Daymark", $"\"{Environment.ProcessPath}\" --background");
            else key.DeleteValue("Daymark", false);
        }
    }
}
