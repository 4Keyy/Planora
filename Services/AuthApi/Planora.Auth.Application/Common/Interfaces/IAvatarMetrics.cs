namespace Planora.Auth.Application.Common.Interfaces;

/// <summary>
/// Emits metrics for the avatar-upload pipeline. Implementation lives in Infrastructure
/// and wraps <c>PlanoraMetrics</c>; keeping the abstraction here lets Application stay
/// metrics-vendor-agnostic and lets the architecture test enforce that Application has
/// no direct reference to BuildingBlocks.Infrastructure.
/// </summary>
public interface IAvatarMetrics
{
    void RecordOutcome(string outcome);

    void RecordVariantBytes(string variantSize, long bytes);
}
