using AutoMapper;
using Planora.Messaging.Application.DTOs;
using Planora.Messaging.Domain.Entities;

namespace Planora.Messaging.Application.Features.Messages.Mappings
{
    public sealed class MessageMappingProfile : Profile
    {
        public MessageMappingProfile()
        {
            CreateMap<Message, MessageDto>()
                .ReverseMap();
        }
    }
}
