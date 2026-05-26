using Planora.Auth.Application.Common.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class AvatarMetrics : IAvatarMetrics
{
    public void RecordOutcome(string outcome)
    {
        PlanoraMetrics.AvatarUploads.Add(1, new KeyValuePair<string, object?>("outcome", outcome));
    }

    public void RecordVariantBytes(string variantSize, long bytes)
    {
        PlanoraMetrics.AvatarVariantBytes.Record(bytes, new KeyValuePair<string, object?>("size", variantSize));
    }
}
