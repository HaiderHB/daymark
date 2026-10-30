using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Windows.Media.Control;

namespace Daymark;

public sealed class WindowsProbe
{
    private GlobalSystemMediaTransportControlsSessionManager? media;
    private uint lastPid;
    private string lastApp = "unknown";
    private bool lastGame;
    private long lastResolve;
    public async Task InitializeAsync()
    {
        try { media = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync(); }
        catch { /* Windows media integration is optional; browser signals still work. */ }
    }
    public Observation Read(bool locked, IReadOnlyCollection<string> captureTitleApps)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var info = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() };
        long idle = GetLastInputInfo(ref info) ? unchecked((uint)Environment.TickCount - info.Tick) : 0;
        var foreground = GetForegroundWindow();
        GetWindowThreadProcessId(foreground, out var pid);
        if (pid != lastPid || now - lastResolve > 30_000)
        {
            lastPid = pid; lastResolve = now; lastApp = "unknown"; lastGame = false;
            try
            {
                using var process = Process.GetProcessById((int)pid);
                lastApp = Settings.NormalizeApp(process.ProcessName);
                var path = process.MainModule?.FileName ?? "";
                lastGame = new[] { "\\steamapps\\", "\\Epic Games\\", "\\Riot Games\\", "\\XboxGames\\" }.Any(p => path.Contains(p, StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or ArgumentException or NotSupportedException) { }
        }
        bool playing = false;
        try
        {
            // A background music player must not keep an idle foreground app active.
            playing = media?.GetSessions().Any(s => MatchesMediaApp(s.SourceAppUserModelId, lastApp) && s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) ?? false;
        }
        catch { }
        string? title = null;
        if (!locked && captureTitleApps.Contains(lastApp))
        {
            var text = new StringBuilder(513);
            GetWindowText(foreground, text, text.Capacity);
            title = text.ToString().Trim();
            if (title.Length == 0) title = null;
        }
        return new(now, lastApp, idle, playing, locked, Game: lastGame, Title: title);
    }
    internal static bool MatchesMediaApp(string source, string app)
    {
        var id = source.ToLowerInvariant();
        return id == app || id.StartsWith(app + ".", StringComparison.Ordinal) || id.StartsWith(app + "_", StringComparison.Ordinal) || id.Contains("!" + app, StringComparison.Ordinal);
    }
    [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint Size; public uint Tick; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int maxCount);
}
