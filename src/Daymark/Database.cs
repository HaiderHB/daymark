using Microsoft.Data.Sqlite;

namespace Daymark;

public sealed class Database : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly object gate = new();
    public Database(string directory)
    {
        Directory.CreateDirectory(directory);
        connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(directory, "activity.db") }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS segments (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, end INTEGER NOT NULL, app TEXT NOT NULL, kind TEXT NOT NULL, domain TEXT, media INTEGER NOT NULL, game INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_segments_end ON segments(end);
            CREATE TABLE IF NOT EXISTS ai_events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, seen INTEGER NOT NULL, provider TEXT NOT NULL, session TEXT NOT NULL, project TEXT, state TEXT NOT NULL, evidence TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_ai_seen ON ai_events(seen);
            CREATE INDEX IF NOT EXISTS ix_ai_session ON ai_events(provider,session,id);
            """;
        command.ExecuteNonQuery();
        using var columns = connection.CreateCommand();
        columns.CommandText = "PRAGMA table_info(segments)";
        bool hasTitle = false;
        using (var reader = columns.ExecuteReader()) while (reader.Read()) if (reader.GetString(1) == "title") hasTitle = true;
        if (!hasTitle) { using var migration = connection.CreateCommand(); migration.CommandText = "ALTER TABLE segments ADD COLUMN title TEXT"; migration.ExecuteNonQuery(); }
        using var version = connection.CreateCommand(); version.CommandText = "PRAGMA user_version=2"; version.ExecuteNonQuery();
    }
    public void Append(Segment segment)
    {
        if (segment.End <= segment.Start) return;
        lock (gate)
        {
            using var transaction = connection.BeginTransaction();
            using var last = connection.CreateCommand();
            last.Transaction = transaction;
            last.CommandText = "SELECT id,start,end,app,kind,domain,media,game,title FROM segments ORDER BY id DESC LIMIT 1";
            long? mergeId = null;
            using (var reader = last.ExecuteReader())
            {
                if (reader.Read() && reader.GetInt64(2) == segment.Start && reader.GetString(3) == segment.App && reader.GetString(4) == segment.Kind && (reader.IsDBNull(5) ? null : reader.GetString(5)) == segment.Domain && reader.GetBoolean(6) == segment.Media && reader.GetBoolean(7) == segment.Game && (reader.IsDBNull(8) ? null : reader.GetString(8)) == segment.Title)
                    mergeId = reader.GetInt64(0);
            }
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = mergeId != null ? "UPDATE segments SET end=$end WHERE id=$id" : "INSERT INTO segments(start,end,app,kind,domain,media,game,title) VALUES($start,$end,$app,$kind,$domain,$media,$game,$title)";
            command.Parameters.AddWithValue("$id", mergeId ?? 0);
            Bind(command, segment);
            command.ExecuteNonQuery();
            transaction.Commit();
        }
    }
    // Once the grace period expires, reclassify back to last input, but never across media, lock, sleep or a pause.
    public void MarkIdle(long since, long until)
    {
        lock (gate)
        {
            var affected = Read(since, until).OrderByDescending(s => s.Start).ToList();
            long boundary = until;
            foreach (var s in affected)
            {
                if (s.End != boundary || s.Media || s.Kind is not ("active" or "afk")) break;
                boundary = s.Start;
            }
            if (boundary >= until) return;
            using var transaction = connection.BeginTransaction();
            using var trim = connection.CreateCommand();
            trim.Transaction = transaction;
            trim.CommandText = "UPDATE segments SET end=$since WHERE start<$since AND end>$since; DELETE FROM segments WHERE start >= $since AND end <= $until; INSERT INTO segments(start,end,app,kind,domain,media,game) VALUES($since,$until,'','afk',NULL,0,0)";
            trim.Parameters.AddWithValue("$since", boundary);
            trim.Parameters.AddWithValue("$until", until);
            trim.ExecuteNonQuery();
            transaction.Commit();
        }
    }
    public List<Segment> Read(long start, long end)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT start,end,app,kind,domain,media,game,title FROM segments WHERE end>$start AND start<$end ORDER BY start";
            command.Parameters.AddWithValue("$start", start);
            command.Parameters.AddWithValue("$end", end);
            using var reader = command.ExecuteReader();
            var rows = new List<Segment>();
            while (reader.Read()) rows.Add(new(Math.Max(start, reader.GetInt64(0)), Math.Min(end, reader.GetInt64(1)), reader.GetString(2), reader.GetString(3), reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetBoolean(5), reader.GetBoolean(6), reader.IsDBNull(7) ? null : reader.GetString(7)));
            return rows;
        }
    }
    public void Delete(long start, long end)
    {
        lock (gate)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM segments WHERE end>$start AND start<$end";
            command.Parameters.AddWithValue("$start", start);
            command.Parameters.AddWithValue("$end", end);
            // API only exposes all-history deletion; range editing is intentionally not exposed.
            command.ExecuteNonQuery();
        }
    }
    private static void Bind(SqliteCommand command, Segment s)
    {
        command.Parameters.AddWithValue("$start", s.Start); command.Parameters.AddWithValue("$end", s.End);
        command.Parameters.AddWithValue("$app", s.App); command.Parameters.AddWithValue("$kind", s.Kind);
        command.Parameters.AddWithValue("$domain", (object?)s.Domain ?? DBNull.Value);
        command.Parameters.AddWithValue("$media", s.Media); command.Parameters.AddWithValue("$game", s.Game);
        command.Parameters.AddWithValue("$title", (object?)s.Title ?? DBNull.Value);
    }
    public void AddAi(AiEvent value)
    {
        lock (gate)
        {
            using var transaction = connection.BeginTransaction();
            using var last = connection.CreateCommand(); last.Transaction = transaction;
            last.CommandText = "SELECT id,seen,state,evidence FROM ai_events WHERE provider=$provider AND session=$session ORDER BY id DESC LIMIT 1";
            last.Parameters.AddWithValue("$provider", value.Provider); last.Parameters.AddWithValue("$session", value.Session);
            long? id = null;
            using(var r = last.ExecuteReader()) if(r.Read() && r.GetString(2) == value.State && r.GetString(3) == value.Evidence && value.At >= r.GetInt64(1) && value.At-r.GetInt64(1) <= (value.Evidence == "web-ui" ? 90_000 : 1_800_000)) id = r.GetInt64(0);
            using var command = connection.CreateCommand(); command.Transaction = transaction;
            command.CommandText = id.HasValue ? "UPDATE ai_events SET seen=$at,project=$project WHERE id=$id" : "INSERT INTO ai_events(at,seen,provider,session,project,state,evidence) VALUES($at,$at,$provider,$session,$project,$state,$evidence)";
            command.Parameters.AddWithValue("$id", id ?? 0); command.Parameters.AddWithValue("$at", value.At);
            command.Parameters.AddWithValue("$provider", value.Provider); command.Parameters.AddWithValue("$session", value.Session);
            command.Parameters.AddWithValue("$project", (object?)value.Project ?? DBNull.Value); command.Parameters.AddWithValue("$state", value.State); command.Parameters.AddWithValue("$evidence", value.Evidence);
            command.ExecuteNonQuery(); transaction.Commit();
        }
    }
    public List<AiEvent> ReadAi(long start, long end)
    {
        lock(gate)
        {
            using var command = connection.CreateCommand(); command.CommandText = "SELECT at,provider,session,project,state,evidence,seen FROM ai_events WHERE seen >= $since AND at < $end ORDER BY at,id";
            command.Parameters.AddWithValue("$since", Math.Max(0,start-1_800_000)); command.Parameters.AddWithValue("$end", end);
            using var r = command.ExecuteReader(); var rows = new List<AiEvent>();
            while(r.Read()) rows.Add(new(r.GetInt64(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.GetString(4),r.GetString(5),r.GetInt64(6)));
            return rows;
        }
    }
    public void ResetAi(long now)
    {
        foreach(var e in ReadAi(now-1_800_000,now).GroupBy(e=>(e.Provider,e.Session)).Select(g=>g.Last()).Where(e=>e.State != "unknown"))
            AddAi(e with { At=now, Seen=now, State="unknown" });
    }
    public void ClearAi() { lock(gate) { using var command=connection.CreateCommand();command.CommandText="DELETE FROM ai_events";command.ExecuteNonQuery(); } }
    public void Dispose() => connection.Dispose();
}
