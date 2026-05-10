using Microsoft.AspNetCore.Mvc;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Planora.BuildingBlocks.Infrastructure.Services;

[ApiController]
[Route("system")]
public sealed class SystemInfoController : ControllerBase
{
    private readonly IConfiguration _configuration;

    public SystemInfoController(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    [HttpGet("info")]
    public IActionResult GetSystemInfo()
    {
        var assembly = Assembly.GetEntryAssembly();
        var version = assembly?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "1.0.0";
        var serviceName = assembly?.GetName().Name ?? "Unknown";

        var info = new
        {
            Service = serviceName,
            Version = version,
            Environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production",
            Framework = RuntimeInformation.FrameworkDescription,
            OS = RuntimeInformation.OSDescription,
            Machine = Environment.MachineName,
            Uptime = DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime(),
            Timestamp = DateTime.UtcNow
        };

        return Ok(info);
    }
}
