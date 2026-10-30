namespace Daymark;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var directory = Arg(args, "--data-dir") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Daymark");
        int port = int.TryParse(Arg(args, "--port"), out var p) ? p : Tracker.Port;
        if(Arg(args,"--hook") is {} provider) { AiHook.Run(provider,directory,port).GetAwaiter().GetResult(); return; }
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, $"Local\\Daymark-{port}", out var first);
        if (!first)
        {
            try { var settings = new SettingsStore(directory); System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo($"http://127.0.0.1:{port}/#token={settings.Current.UiToken}") { UseShellExecute = true }); } catch { }
            return;
        }
        try
        {
            using var tracker = new Tracker(directory, port, args.Contains("--no-track"));
            using var server = new LocalServer(tracker);
            server.Start();
            using var context = new TrayContext(tracker, args.Contains("--background"));
            Application.Run(context);
        }
        catch (Exception ex) { MessageBox.Show($"Daymark couldn't start.\n\n{ex.Message}", "Daymark", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
    private static string? Arg(string[] args, string name)
    { int index = Array.IndexOf(args, name); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon tray;
    private readonly Control dispatcher = new();
    private readonly Icon icon;
    public TrayContext(Tracker tracker, bool background)
    {
        dispatcher.CreateControl();
        icon = CreateIcon();
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Daymark", null, (_, _) => tracker.OpenDashboard());
        var pause = menu.Items.Add("Pause tracking", null, (_, _) => tracker.SetPaused(!tracker.Paused));
        menu.Items.Add("Open data folder", null, (_, _) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(tracker.DirectoryPath) { UseShellExecute = true }));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Daymark", null, (_, _) => ExitThread());
        tray = new NotifyIcon { Text = "Daymark · Tracking your day", Icon = icon, Visible = true, ContextMenuStrip = menu };
        tray.DoubleClick += (_, _) => tracker.OpenDashboard();
        tracker.StateChanged += () => { if (!dispatcher.IsDisposed) dispatcher.BeginInvoke(() => { pause.Text = tracker.Paused ? "Resume tracking" : "Pause tracking"; tray.Text = tracker.Paused ? "Daymark · Paused" : "Daymark · Tracking your day"; }); };
        _ = tracker.StartAsync();
        if (!background) tracker.OpenDashboard();
    }
    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using var g = Graphics.FromImage(bitmap);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.Clear(Color.Transparent);
        using var bg = new SolidBrush(Color.FromArgb(26, 68, 53));
        using var fg = new SolidBrush(Color.FromArgb(186, 224, 147));
        g.FillEllipse(bg, 0, 0, 32, 32);
        g.FillRectangle(fg, 8, 16, 4, 9); g.FillRectangle(fg, 14, 10, 4, 15); g.FillRectangle(fg, 20, 6, 4, 19);
        var handle = bitmap.GetHicon();
        using var temporary = Icon.FromHandle(handle);
        var result = (Icon)temporary.Clone();
        DestroyIcon(handle); return result;
    }
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    protected override void Dispose(bool disposing)
    {
        if (disposing) { tray.Visible = false; tray.Dispose(); icon.Dispose(); dispatcher.Dispose(); }
        base.Dispose(disposing);
    }
}
