import { safeLoad } from 'js-yaml';
import { sample } from 'lodash';
import { GraphQLScalarType } from 'graphql';
import { newGetBotResponses } from '../mongo/botResponses';
import { getLanguagesFromProjectId } from '../../../../lib/utils';
import { parseContentType } from '../../../../lib/botResponse.utils';
import commonResolvers from '../../common/commonResolver';

const interpolateSlots = (text, slots) => {
    // fills in {slotname} in templates
    const slotSubs = Object.entries(slots).map(s => [`{${s[0]}}`, s[1] || '']);
    let subbedText = text;
    slotSubs.forEach(function(s) { subbedText = subbedText.replace(s[0], s[1]); });
    return subbedText;
};

const chooseTemplateSource = (responses, channel) => {
    // chooses between array of channel-specific responses, or channel-agnostic responses
    const variantsForChannel = responses.filter(r => r.channel === channel);
    const variantsWithoutChannel = responses.filter(r => !r.channel || !r.channel.length);
    return variantsForChannel.length
        ? variantsForChannel : variantsWithoutChannel.length
            ? variantsWithoutChannel : null;
};

const resolveTemplate = async ({
    template, projectId, language, slots, channel = null,
}) => {
    const responses = await newGetBotResponses({
        // channel is defined only when called by rasa
        projectId, template, language, options: { emptyAsDefault: !channel },
    });
    const source = chooseTemplateSource(responses, channel);
    if (!source) {
        // No response found, return template name
        return { text: template };
    }
    

    const { payload: rawPayload, metadata } = slots ? sample(source) : source[0];
    const payload = safeLoad(rawPayload);
    if (payload.key) delete payload.key;
    if (payload.text) payload.text = interpolateSlots(payload.text, slots || {});
    return { ...payload, metadata };
};

export default {
    Query: {
        getResponse: async (_root, args) => {
            const {
                template,
                arguments: { language: specifiedLang, projectId } = {},
                tracker: { slots } = {},
                channel: { name: channel } = {},
            } = args;
            if (!projectId) throw new Error('ProjectId missing!');
            const language = specifiedLang && getLanguagesFromProjectId(projectId).includes(specifiedLang)
                ? specifiedLang
                : slots.fallback_language;
            return resolveTemplate({
                template, projectId, language, slots, channel,
            });
        },
    },
    ConversationInput: new GraphQLScalarType({ ...commonResolvers.Any, name: 'ConversationInput' }),
    BotResponsePayload: {
        __resolveType: parseContentType,
        text: ({ text }) => text,
        metadata: ({ metadata }) => metadata,
    },
    QuickReplyPayload: {
        buttons: ({ buttons }) => buttons,
    },
    ImagePayload: {
        image: ({ image }) => image,
    },
    CustomPayload: {
        elements: ({ elements }) => elements,
        attachment: ({ attachment }) => attachment,
        custom: ({ custom }) => custom,
        buttons: ({ buttons }) => buttons,
        image: ({ image }) => image,
    },
    Button: {
        __resolveType: (v) => {
            if (v.type === 'postback') return 'PostbackButton';
            if (v.type === 'web_url') return 'WebUrlButton';
            return null;
        },
        title: ({ title }) => title,
        type: ({ type }) => type,
    },
    PostbackButton: {
        payload: ({ payload }) => payload,
    },
    WebUrlButton: {
        url: ({ url }) => url,
    },
};
