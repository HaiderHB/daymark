using Xunit;

namespace Daymark.Tests;

public sealed class TrackingTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "Daymark-tests-" + Guid.NewGuid());
    private readonly Database db;
    private readonly Collector collector;
    private readonly Settings settings = new() { IdleMinutes = 1 };
    private const long Epoch = 1_800_000_000_000;
    public TrackingTests() { db = new(directory); collector = new(db); }
    private void Sample(int second, long idle = 0, bool media = false, bool locked = false, string app = "cursor") => collector.Sample(new(Epoch + second * 1000, app, idle, media, locked), settings);
    private List<Segment> Rows() => db.Read(0, long.MaxValue);
    [Fact] public void ContinuousActivityCoalescesWithoutOverlap()
    { Sample(0); Sample(5); Sample(10); var s = Assert.Single(Rows()); Assert.Equal(10_000, s.End-s.Start); Assert.Equal("cursor", s.App); }
    [Fact] public void IdleIsBackdatedAfterGracePeriod()
    { for(int i=0;i<=65;i+=5)Sample(i,i*1000); var s=Assert.Single(Rows()); Assert.Equal("afk",s.Kind); Assert.Equal(65_000,s.End-s.Start); }
    [Fact] public void IdleSplitsAnActiveSegmentAtLastInput()
    { for(int i=0;i<=90;i+=5)Sample(i,Math.Max(0,(i-30)*1000)); var rows=Rows(); Assert.Equal(2,rows.Count);Assert.Equal("active",rows[0].Kind);Assert.Equal(30_000,rows[0].End-rows[0].Start);Assert.Equal("afk",rows[1].Kind);Assert.Equal(60_000,rows[1].End-rows[1].Start); }
    [Fact] public void ForegroundMediaPreventsIdleButDoesNotOverrideLock()
    { for(int i=0;i<=70;i+=5)Sample(i,i*1000,true);Assert.All(Rows(),s=>Assert.Equal("active",s.Kind));Sample(75,75000,true,true);Sample(80,80000,true,true);Assert.Equal("locked",Rows()[^1].Kind); }
    [Fact] public void SleepGapIsOfflineRatherThanWorkOrAfk()
    { Sample(0);Sample(5);Sample(3600,3600000);Assert.Equal("offline",Rows()[^1].Kind);Assert.Equal(3_595_000,Rows()[^1].End-Rows()[^1].Start); }
    [Fact] public void PausesDoNotCreateActivityOrRetroactivelyEraseEarlierWork()
    { Sample(0);Sample(5);collector.Reset();Sample(30,30000);for(int i=35;i<=65;i+=5)Sample(i,i*1000);Assert.Equal("active",Rows()[0].Kind);Assert.Equal(5_000,Rows()[0].End-Rows()[0].Start);Assert.Equal(Epoch+30000,Rows()[1].Start); }
    [Fact] public void StoppingMediaDoesNotEraseTheWatchedPeriod()
    { for(int i=0;i<=60;i+=5)Sample(i,i*1000,true);Sample(65,65000);Sample(70,70000);Assert.True(Rows()[0].Media);Assert.Equal("active",Rows()[0].Kind);Assert.Equal("afk",Rows()[^1].Kind); }
    [Fact] public void ReadClipsWithoutChangingStoredRows()
    {Sample(0);Sample(5);Sample(10);var s=Assert.Single(db.Read(Epoch+2000,Epoch+8000));Assert.Equal(6000,s.End-s.Start);Assert.Equal(10000,Rows()[0].End-Rows()[0].Start);}
    [Fact] public void AllowlistRejectsUnapprovedHostsAndNormalizesAllowedSubdomains()
    {Assert.Equal("youtube.com",settings.AllowedDomain("chrome","www.youtube.com"));Assert.Null(settings.AllowedDomain("chrome","youtube.com.evil.com"));Assert.Null(settings.AllowedDomain("vivaldi","youtube.com"));Assert.Null(Settings.NormalizeDomain("youtube.com/watch?v=private"));}
    [Fact] public void SettingsPersistTokensAndRejectInvalidThresholds()
    {var store=new SettingsStore(directory);var token=store.Current.UiToken;Assert.Equal(token,new SettingsStore(directory).Current.UiToken);settings.IdleMinutes=0;Assert.Throws<ArgumentException>(settings.Validate);}
    [Fact] public void TitleChangesSplitAppIntervalsAndAfkDoesNotRetainTitles()
    {collector.Sample(new(Epoch,"cursor",0,false,false,Title:"file - repo - Cursor"),settings);collector.Sample(new(Epoch+5000,"cursor",0,false,false,Title:"file - other - Cursor"),settings);collector.Sample(new(Epoch+10000,"cursor",0,false,false),settings);Assert.Equal(2,Rows().Count);Assert.Equal("file - repo - Cursor",Rows()[0].Title);db.MarkIdle(Epoch,Epoch+10000);Assert.Null(Assert.Single(Rows()).Title);}
    [Fact] public void AiHeartbeatsMergeButStateChangesRemainDistinct()
    {db.AddAi(new(Epoch,"codex","session","repo","running","hook"));db.AddAi(new(Epoch+5000,"codex","session","repo","running","hook"));db.AddAi(new(Epoch+10000,"codex","session","repo","waiting","hook"));var events=db.ReadAi(Epoch,Epoch+20000);Assert.Equal(2,events.Count);Assert.Equal(Epoch+5000,events[0].Seen);Assert.Equal("waiting",events[1].State);db.ResetAi(Epoch+15000);Assert.Equal("unknown",db.ReadAi(Epoch,Epoch+20000)[^1].State);}
    [Theory]
    [InlineData("UserPromptSubmit","running")]
    [InlineData("PermissionRequest","waiting")]
    [InlineData("Stop","idle")]
    [InlineData("Interrupt","idle")]
    public void HookParsingDiscardsPromptTextAndFullPaths(string hook,string state)
    {using var json=System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(new{hook_event_name=hook,session_id="raw-private-session",cwd=@"C:\Users\Example\Code\my-repo",prompt="PRIVATE PROMPT",last_assistant_message="PRIVATE ANSWER"}));var signal=AiHook.Parse("codex",json.RootElement)!;Assert.Equal(state,signal.State);Assert.Equal("my-repo",signal.Project);Assert.NotEqual("raw-private-session",signal.Session);Assert.DoesNotContain("PRIVATE",System.Text.Json.JsonSerializer.Serialize(signal));}
    public void Dispose(){db.Dispose();Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();Directory.Delete(directory,true);}
}
