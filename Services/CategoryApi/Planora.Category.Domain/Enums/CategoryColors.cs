namespace Planora.Category.Domain.Enums
{
    public static class CategoryColors
    {
        public static readonly string[] Predefined = new[]
        {
            "#007BFF", // Blue
            "#28A745", // Green
            "#DC3545", // Red
            "#FFC107", // Yellow
            "#17A2B8", // Cyan
            "#6F42C1", // Purple
            "#E83E8C", // Pink
            "#FD7E14"  // Orange
        };

        public static bool IsValid(string color)
        {
            if (string.IsNullOrWhiteSpace(color))
                return false;

            return Predefined.Contains(color) ||
                   (color.StartsWith('#') && color.Length == 7 &&
                    color.Skip(1).All(c => char.IsDigit(c) ||
                                      char.IsLetter(c)));
        }
    }
}
