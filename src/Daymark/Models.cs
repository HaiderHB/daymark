using System.Security.Cryptography;
using System.Text.Json;

namespace Daymark;

public record AppRule(string Process, string Name, string Category);
public record SiteRule(string Browser, string Domain, string Category);
public record BrowserPulse(string Browser, string? Domain, bool Playing, bool Focused);
public record Segment(long Start, long End, string App, string Kind, string? Domain, bool Media, bool Game, string? Title = null);
public record Observation(long At, string App, long IdleMs, bool Media, bool Locked, string? Domain = null, bool Game = false, string? Title = null);
public record AiSignal(string Provider, string Session, string? Project, string State, string Evidence);
public record AiEvent(long At, string Provider, string Session, string? Project, string State, string Evidence, long Seen = 0);

public sealed class Settings
{
    public int IdleMinutes { get; set; } = 3;
    public bool MediaKeepsActive { get; set; } = true;
    public List<string> CaptureTitleApps { get; set; } = ["vivaldi", "cursor"];
    public bool AiTrackingEnabled { get; set; } = true;
    public bool AiWebEnabled { get; set; } = true;
    public List<AppRule> Apps { get; set; } = [
        new("claude", "Claude", "work"), new("chatgpt", "ChatGPT", "work"),
        new("gpt", "GPT", "work"), new("vivaldi", "Vivaldi", "work"),
        new("cursor", "Cursor", "work"), new("capacity", "Capacity", "work"),
        new("linear", "Linear", "work"), new("hermes", "Hermes", "work"),
        new("chrome", "Google Chrome", "personal"), new("steam", "Steam", "personal"),
        new("steamwebhelper", "Steam", "personal")
    ];
    public List<SiteRule> Sites { get; set; } = [new("chrome", "youtube.com", "personal"), new("chrome", "twitch.tv", "personal")];
    public string UiToken { get; set; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public string BrowserToken { get; set; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public string IntegrationToken { get; set; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public static string NormalizeApp(string value) => value.Trim().ToLowerInvariant().Replace(".exe", "");
    public static string? NormalizeDomain(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 253 || value.Contains('/') || value.Contains(':') || value.Contains('@')) return null;
        var domain = value.Trim().ToLowerInvariant().TrimEnd('.');
        return Uri.CheckHostName(domain) == UriHostNameType.Dns && domain.Contains('.') ? domain : null;
    }
    public string? AllowedDomain(string browser, string? domain) => Sites.FirstOrDefault(s =>
        s.Browser == browser && domain != null && (domain == s.Domain || domain.EndsWith('.' + s.Domain, StringComparison.Ordinal)))?.Domain;
    public void Validate()
    {
        if (IdleMinutes is < 1 or > 30 || Apps.Count > 500 || Sites.Count > 100) throw new ArgumentException("Use an AFK threshold of 1–30 minutes, up to 500 app rules and 100 sites.");
        CaptureTitleApps = CaptureTitleApps.Where(a => a is "vivaldi" or "cursor").Distinct().ToList();
        if (Apps.Any(a => string.IsNullOrWhiteSpace(a.Process) || a.Process.Length > 100 || a.Name.Length > 100 || !Categories.Contains(a.Category))) throw new ArgumentException("Invalid app rule.");
        Apps = Apps.Select(a => a with { Process = NormalizeApp(a.Process), Name = a.Name.Trim() }).DistinctBy(a => a.Process).ToList();
        if (Sites.Any(s => NormalizeDomain(s.Domain) == null || !Browsers.Contains(s.Browser) || !Categories.Contains(s.Category))) throw new ArgumentException("Use a domain such as youtube.com and a supported browser.");
        Sites = Sites.Select(s => s with { Domain = NormalizeDomain(s.Domain)! }).DistinctBy(s => (s.Browser, s.Domain)).ToList();
    }
    public static readonly string[] Categories = ["work", "personal", "neutral"];
    public static readonly string[] Browsers = ["chrome", "vivaldi", "msedge", "brave", "firefox"];
}

public sealed class SettingsStore
{
    private readonly string path;
    public Settings Current { get; private set; }
    public SettingsStore(string directory)
    {
        Directory.CreateDirectory(directory);
        path = Path.Combine(directory, "settings.json");
        Current = File.Exists(path) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), Settings.Json) ?? new() : new();
        Current.Validate();
        Save(Current);
    }
    public void Save(Settings settings)
    {
        settings.Validate();
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(settings, Settings.Json));
        File.Move(path + ".tmp", path, true);
        Current = settings;
    }
}
