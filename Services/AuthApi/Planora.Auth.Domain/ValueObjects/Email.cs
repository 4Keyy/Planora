using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using System.Text.RegularExpressions;

namespace Planora.Auth.Domain.ValueObjects
{
    public sealed class Email : ValueObject
    {
        private static readonly Regex EmailRegex = new(
            @"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public string Value { get; }

        private Email()
        {
            Value = string.Empty;
        }

        private Email(string value)
        {
            Value = value;
        }

        public static Email Create(string email)
        {
            if (string.IsNullOrWhiteSpace(email))
                throw new InvalidValueObjectException(nameof(Email), "Email cannot be empty");

            email = email.Trim().ToLowerInvariant();

            if (email.Length > 255)
                throw new InvalidValueObjectException(nameof(Email), "Email cannot be longer than 255 characters");

            if (!EmailRegex.IsMatch(email))
                throw new InvalidValueObjectException(nameof(Email), "Email format is invalid");

            return new Email(email);
        }

        protected override IEnumerable<object?> GetEqualityComponents()
        {
            yield return Value;
        }

        public override string ToString() => Value;

        public static implicit operator string(Email email) => email.Value;
    }
}
