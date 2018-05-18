function cleanHtml(html) {
    let cleanedHTML = html;

    // Remove HEAD
    cleanedHTML = `<body${cleanedHTML.split('<body')[1]}`;

    // Remove self closing script tags (someone may use it)
    cleanedHTML = cleanedHTML.replace(/<script[^>]+\/>/gi, '');

    // remove script tags
    cleanedHTML = cleanedHTML.split('<script').map(block => {
        const tagEnd = block.indexOf('</script>');
        if (tagEnd === -1) return block;

        block = block.substr(tagEnd + '</script>'.length);
        return block;
    }).join('');

    // remove SCRIPT tags
    cleanedHTML = cleanedHTML.split('<SCRIPT').map(block => {
        const tagEnd = block.indexOf('</SCRIPT>');
        if (tagEnd === -1) return block;

        block = block.substr(tagEnd + '</SCRIPT>'.length);
        return block;
    }).join('');

    // remove comments
    cleanedHTML = cleanedHTML.split('<!--').map(block => {
        const tagEnd = block.indexOf('-->');
        if (tagEnd === -1) return block;

        block = block.substr(tagEnd + '-->'.length);
        return block;
    }).join('');

    return cleanedHTML;
}

module.exports = cleanHtml;
