namespace Planora.BuildingBlocks.Infrastructure.Messaging
{
    public sealed class EventBusOptions
    {
        public int MaxRetries { get; set; } = 3;
        public int RetryDelayMs { get; set; } = 1000;
        public int MessageTtlMs { get; set; } = 86400000; // 24 hours
        public int PrefetchCount { get; set; } = 10;
        public bool EnableDeadLetterQueue { get; set; } = true;
        public string DeadLetterExchange { get; set; } = "dlx.events";
        public string DeadLetterQueue { get; set; } = "dlq.events";
        public bool EnableOutboxPattern { get; set; } = true;
    }
}
