using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Daymark;

public static class AiHook
{
    public static AiSignal? Parse(string provider, JsonElement input)
    {
        if(provider is not ("claude-code" or "codex")) return null;
        string Get(string name) => input.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
        var hook = Get("hook_event_name");
        var state = hook switch
        {
            "UserPromptSubmit" or "PreToolUse" or "PostToolUse" or "PostToolUseFailure" or "SubagentStart" or "PostCompact" => "running",
            "PermissionRequest" => "waiting",
            "Stop" or "StopFailure" or "Interrupt" or "SessionEnd" or "SubagentStop" => "idle",
            "SessionStart" => "idle",
            _ => "unknown"
        };
        if(hook == "Notification") state = Get("notification_type") is "permission_prompt" or "idle_prompt" ? "waiting" : "unknown";
        if(hook == "PreToolUse" && Get("tool_name") is "AskUserQuestion" or "request_user_input") state = "waiting";
        if(state == "unknown" || Get("session_id").Length == 0) return null;
        var identity = Get("session_id") + (hook is "SubagentStart" or "SubagentStop" ? ":" + Get("agent_id") : "");
        var session = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..24];
        var cwd = Get("cwd").Replace('\\','/').TrimEnd('/');
        var project = cwd.Split('/').LastOrDefault();
        if(project?.Length > 100) project = project[..100];
        return new(provider, session, project, state, "hook");
    }
    public static async Task Run(string provider, string directory, int port)
    {
        try
        {
            using var stream = Console.OpenStandardInput();
            using var input = await JsonDocument.ParseAsync(stream);
            var pulse = Parse(provider,input.RootElement);
            if(pulse == null) return;
            // Read only the local integration key. Never copy prompt, response, tool input or transcript contents.
            using var config = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory,"settings.json")));
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1200) };
            client.DefaultRequestHeaders.Authorization = new("Bearer",config.RootElement.GetProperty("integrationToken").GetString());
            using var response = await client.PostAsJsonAsync($"http://127.0.0.1:{port}/api/ai",pulse,Settings.Json);
        }
        catch { /* Observing must never block, fail or change an AI task. */ }
        finally
        {
            try { using var output = new StreamWriter(Console.OpenStandardOutput()); await output.WriteLineAsync("{}"); } catch { }
        }
    }
}
