namespace Daymark;

public sealed class Collector(Database database)
{
    private Observation? previous;
    private string previousKind = "active";
    public string Kind { get; private set; } = "starting";
    public string App { get; private set; } = "";
    public void Reset() { previous = null; Kind = "paused"; App = ""; }
    public void Sample(Observation current, Settings settings)
    {
        var media = settings.MediaKeepsActive && current.Media;
        Kind = current.Locked ? "locked" : current.IdleMs >= settings.IdleMinutes * 60_000 && !media ? "afk" : "active";
        App = current.App;
        if (previous is { } last && current.At > last.At)
        {
            bool gap = current.At - last.At > 20_000;
            var kind = gap ? "offline" : previousKind;
            database.Append(new(last.At, current.At, kind == "active" ? last.App : "", kind, kind == "active" ? last.Domain : null, !gap && last.Media && settings.MediaKeepsActive, !gap && last.Game, kind == "active" ? last.Title : null));
            if (!gap && Kind == "afk") database.MarkIdle(Math.Max(0, current.At - current.IdleMs), current.At);
        }
        previous = current with { Media = media };
        previousKind = Kind;
    }
}
