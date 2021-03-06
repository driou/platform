// Copyright (c) 2015 Spinpunch, Inc. All Rights Reserved.
// See License.txt for license information.

const Autolinker = require('autolinker');
const Constants = require('./constants.jsx');
const Markdown = require('./markdown.jsx');
const UserStore = require('../stores/user_store.jsx');
const Utils = require('./utils.jsx');

const marked = require('marked');

const markdownRenderer = new Markdown.MattermostMarkdownRenderer();

// Performs formatting of user posts including highlighting mentions and search terms and converting urls, hashtags, and
// @mentions to links by taking a user's message and returning a string of formatted html. Also takes a number of options
// as part of the second parameter:
// - searchTerm - If specified, this word is highlighted in the resulting html. Defaults to nothing.
// - mentionHighlight - Specifies whether or not to highlight mentions of the current user. Defaults to true.
// - singleline - Specifies whether or not to remove newlines. Defaults to false.
// - markdown - Enables markdown parsing. Defaults to true.
export function formatText(text, options = {}) {
    if (!('markdown' in options)) {
        options.markdown = true;
    }

    // wait until marked can sanitize the html so that we don't break markdown block quotes
    let output;
    if (!options.markdown) {
        output = sanitizeHtml(text);
    } else {
        output = text;
    }

    const tokens = new Map();

    // replace important words and phrases with tokens
    output = autolinkUrls(output, tokens, !!options.markdown);
    output = autolinkAtMentions(output, tokens);
    output = autolinkHashtags(output, tokens);

    if (options.searchTerm) {
        output = highlightSearchTerm(output, tokens, options.searchTerm);
    }

    if (!('mentionHighlight' in options) || options.mentionHighlight) {
        output = highlightCurrentMentions(output, tokens);
    }

    // perform markdown parsing while we have an html-free input string
    if (options.markdown) {
        output = marked(output, {
            renderer: markdownRenderer,
            sanitize: true
        });
    }

    // reinsert tokens with formatted versions of the important words and phrases
    output = replaceTokens(output, tokens);

    // replace newlines with html line breaks
    if (options.singleline) {
        output = replaceNewlines(output);
    }

    return output;
}

export function sanitizeHtml(text) {
    let output = text;

    // normal string.replace only does a single occurrance so use a regex instead
    output = output.replace(/&/g, '&amp;');
    output = output.replace(/</g, '&lt;');
    output = output.replace(/>/g, '&gt;');
    output = output.replace(/'/g, '&apos;');
    output = output.replace(/"/g, '&quot;');

    return output;
}

function autolinkUrls(text, tokens, markdown) {
    function replaceUrlWithToken(autolinker, match) {
        const linkText = match.getMatchedText();
        let url = linkText;

        if (url.lastIndexOf('http', 0) !== 0) {
            url = `http://${linkText}`;
        }

        const index = tokens.size;
        const alias = `MM_LINK${index}`;

        tokens.set(alias, {
            value: `<a class='theme' target='_blank' href='${url}'>${linkText}</a>`,
            originalText: linkText
        });

        return alias;
    }

    // we can't just use a static autolinker because we need to set replaceFn
    const autolinker = new Autolinker({
        urls: true,
        email: true,
        phone: false,
        twitter: false,
        hashtag: false,
        replaceFn: replaceUrlWithToken
    });

    let output = text;

    // temporarily replace markdown links if markdown is enabled so that we don't accidentally parse them twice
    const markdownLinkTokens = new Map();
    if (markdown) {
        function replaceMarkdownLinkWithToken(markdownLink) {
            const index = markdownLinkTokens.size;
            const alias = `MM_MARKDOWNLINK${index}`;

            markdownLinkTokens.set(alias, {value: markdownLink});

            return alias;
        }

        output = output.replace(/\]\([^\)]*\)/g, replaceMarkdownLinkWithToken);
    }

    output = autolinker.link(output);

    if (markdown) {
        output = replaceTokens(output, markdownLinkTokens);
    }

    return output;
}

function autolinkAtMentions(text, tokens) {
    let output = text;

    function replaceAtMentionWithToken(fullMatch, prefix, mention, username) {
        const usernameLower = username.toLowerCase();
        if (Constants.SPECIAL_MENTIONS.indexOf(usernameLower) !== -1 || UserStore.getProfileByUsername(usernameLower)) {
            const index = tokens.size;
            const alias = `MM_ATMENTION${index}`;

            tokens.set(alias, {
                value: `<a class='mention-link' href='#' data-mention='${usernameLower}'>${mention}</a>`,
                originalText: mention
            });

            return prefix + alias;
        }

        return fullMatch;
    }

    output = output.replace(/(^|\s)(@([a-z0-9.\-_]*[a-z0-9]))/gi, replaceAtMentionWithToken);

    return output;
}

function highlightCurrentMentions(text, tokens) {
    let output = text;

    const mentionKeys = UserStore.getCurrentMentionKeys();

    // look for any existing tokens which are self mentions and should be highlighted
    var newTokens = new Map();
    for (const [alias, token] of tokens) {
        if (mentionKeys.indexOf(token.originalText) !== -1) {
            const index = tokens.size + newTokens.size;
            const newAlias = `MM_SELFMENTION${index}`;

            newTokens.set(newAlias, {
                value: `<span class='mention-highlight'>${alias}</span>`,
                originalText: token.originalText
            });

            output = output.replace(alias, newAlias);
        }
    }

    // the new tokens are stashed in a separate map since we can't add objects to a map during iteration
    for (const newToken of newTokens) {
        tokens.set(newToken[0], newToken[1]);
    }

    // look for self mentions in the text
    function replaceCurrentMentionWithToken(fullMatch, prefix, mention) {
        const index = tokens.size;
        const alias = `MM_SELFMENTION${index}`;

        tokens.set(alias, {
            value: `<span class='mention-highlight'>${mention}</span>`,
            originalText: mention
        });

        return prefix + alias;
    }

    for (const mention of UserStore.getCurrentMentionKeys()) {
        output = output.replace(new RegExp(`(^|\\W)(${mention})\\b`, 'gi'), replaceCurrentMentionWithToken);
    }

    return output;
}

function autolinkHashtags(text, tokens) {
    let output = text;

    var newTokens = new Map();
    for (const [alias, token] of tokens) {
        if (token.originalText.lastIndexOf('#', 0) === 0) {
            const index = tokens.size + newTokens.size;
            const newAlias = `MM_HASHTAG${index}`;

            newTokens.set(newAlias, {
                value: `<a class='mention-link' href='#' data-hashtag='${token.originalText}'>${token.originalText}</a>`,
                originalText: token.originalText
            });

            output = output.replace(alias, newAlias);
        }
    }

    // the new tokens are stashed in a separate map since we can't add objects to a map during iteration
    for (const newToken of newTokens) {
        tokens.set(newToken[0], newToken[1]);
    }

    // look for hashtags in the text
    function replaceHashtagWithToken(fullMatch, prefix, hashtag) {
        const index = tokens.size;
        const alias = `MM_HASHTAG${index}`;

        tokens.set(alias, {
            value: `<a class='mention-link' href='#' data-hashtag='${hashtag}'>${hashtag}</a>`,
            originalText: hashtag
        });

        return prefix + alias;
    }

    return output.replace(/(^|\W)(#[a-zA-Z0-9.\-_]+)\b/g, replaceHashtagWithToken);
}

function highlightSearchTerm(text, tokens, searchTerm) {
    let output = text;

    var newTokens = new Map();
    for (const [alias, token] of tokens) {
        if (token.originalText === searchTerm) {
            const index = tokens.size + newTokens.size;
            const newAlias = `MM_SEARCHTERM${index}`;

            newTokens.set(newAlias, {
                value: `<span class='search-highlight'>${alias}</span>`,
                originalText: token.originalText
            });

            output = output.replace(alias, newAlias);
        }
    }

    // the new tokens are stashed in a separate map since we can't add objects to a map during iteration
    for (const newToken of newTokens) {
        tokens.set(newToken[0], newToken[1]);
    }

    function replaceSearchTermWithToken(fullMatch, prefix, word) {
        const index = tokens.size;
        const alias = `MM_SEARCHTERM${index}`;

        tokens.set(alias, {
            value: `<span class='search-highlight'>${word}</span>`,
            originalText: word
        });

        return prefix + alias;
    }

    return output.replace(new RegExp(`(^|\\W)(${searchTerm})\\b`, 'gi'), replaceSearchTermWithToken);
}

function replaceTokens(text, tokens) {
    let output = text;

    // iterate backwards through the map so that we do replacement in the opposite order that we added tokens
    const aliases = [...tokens.keys()];
    for (let i = aliases.length - 1; i >= 0; i--) {
        const alias = aliases[i];
        const token = tokens.get(alias);
        output = output.replace(alias, token.value);
    }

    return output;
}

function replaceNewlines(text) {
    return text.replace(/\n/g, ' ');
}

// A click handler that can be used with the results of TextFormatting.formatText to add default functionality
// to clicked hashtags and @mentions.
export function handleClick(e) {
    const mentionAttribute = e.target.getAttributeNode('data-mention');
    const hashtagAttribute = e.target.getAttributeNode('data-hashtag');

    if (mentionAttribute) {
        Utils.searchForTerm(mentionAttribute.value);
    } else if (hashtagAttribute) {
        Utils.searchForTerm(hashtagAttribute.value);
    }
}
