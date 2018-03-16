const cheerio = require('cheerio');
const { concat, isArray, sortBy, isString } = require('lodash'); // eslint-disable-line
const { AllHtmlEntities } = require('html-entities');

const entities = new AllHtmlEntities();
const removeHTMLTags = (text) => text.replace(/<[^>]*>?/g, '');
const replaceHTMLEntities = (text) => entities.decode(text);
const removeSpaces = (text) => text.replace(/\s/g, '');
const convertCommasInNumbers = (text) => text.replace(/(\d+),(\d+)/g, '$1.$2');

const normalize = (text) => {
    if (!isString(text)) return text;
    let normalized = removeHTMLTags(text).toLowerCase();
    normalized = replaceHTMLEntities(normalized);
    normalized = removeSpaces(normalized);
    normalized = convertCommasInNumbers(normalized);
    return normalized;
};

const LETTER_DEDUCTION = 0.01;

class DOMSearcher {
    constructor({ $, html }) {
        if (!$ && !html) throw new Error('DOMSearcher requires cheerio instance or HTML code.');
        this.$ = $ || cheerio.load(html);
        this.searchElement = this.searchElement.bind(this);
        this.findPath = this.findPath.bind(this);
        this.createSelector = this.createSelector.bind(this);
    }

    setHTML(html) {
        this.$ = cheerio.load(html);
    }

    createSelector(path, item) {
        const { $ } = this;

        const completePath = concat(path, item);

        const elementsWithId = completePath.map(step => !!step.id);
        const lastUsableID = elementsWithId.lastIndexOf(true);

        const importantPartOfPath = lastUsableID !== -1
            ? completePath.slice(lastUsableID)
            : completePath;

        const parts = importantPartOfPath.map((step, i) => {
            let classes = step.class && step.class.trim() ? `.${step.class.trim().split(' ').join('.')}` : '';
            // remove bootstrap column classes
            classes = classes.replace(/\.col-[^.]+-\d+/gi, '');
            // remove even/odd classes
            classes = classes.replace(/\.even/gi, '').replace(/\.odd/gi, '');
            if (classes === '.' || classes === '') classes = undefined;
            return {
                id: step.id,
                tag: step.tag,
                classes: classes ? classes.substr(1).split('.') : undefined,
                position: step.nthChild || i === importantPartOfPath.length - 1 ? `:nth-child(${(step.nthChild || 0) + 1})` : '',
            };
        });

        const getSelector = (step) => {
            let selector;
            if (step.id) {
                selector = `${step.tag}[id='${step.id}']`;
                if ($(selector).length === 1) return selector;
            }
            if (step.classes) {
                selector = step.classes.reduce((uniqueSelector, stepClass) => {
                    if (uniqueSelector) return uniqueSelector;

                    let classSelector = `.${stepClass}`;
                    if ($(classSelector).length === 1) return classSelector;

                    classSelector = `${step.tag}.${stepClass}`;
                    if ($(classSelector).length === 1) return classSelector;

                    return false;
                }, false);
                if (selector) return selector;
                selector = `${step.tag}.${step.classes.join('.')}`;
                if ($(selector).length === 1) return selector;
            }
            selector = `${step.tag}`;
            if ($(selector).length === 1) return selector;
            if (step.classes) return `${step.tag}.${step.classes.join('.')}`;
            return `${step.tag}${step.position}`;
        };

        let lastPart = parts.pop();
        let partialSelector = getSelector(lastPart, true);
        let selector = partialSelector;
        let options = $(selector);
        while (
            (
                options.length > 1 ||
                !!partialSelector.match(/(.*):nth-child\((.*)\)/) ||
                !!partialSelector.match(/^(\w+)$/)
            ) && parts.length > 0
        ) {
            lastPart = parts.pop();
            partialSelector = getSelector(lastPart);
            selector = `${partialSelector} > ${selector}`;
            options = $(selector);
        }

        return selector;
    }

    removeIgnoredTexts(text) {
        this.normalizedIgnore.forEach(ignoreString => {
            text = text.replace(ignoreString, '');
        });
        return text;
    }

    searchElement(tagName, $element) {
        const { searchElement, $ } = this;

        const elementText = $element.text();
        const elementData = {
            tag: tagName,
            class: $element.attr('class'),
            id: $element.attr('id'),
        };
        const normalizedText = this.removeIgnoredTexts(normalize(elementText)); // to lower case to match most results
        const score = this.normalizedSearch.reduce((lastScore, searchString) => {
            if (normalizedText.indexOf(searchString) === -1) return lastScore;
            const remainingTextLength = normalizedText.replace(searchString, '').length;
            const searchScore = (1 + (remainingTextLength * LETTER_DEDUCTION));
            return Math.max(lastScore, searchScore);
        }, 0);

        if (score === 0) return elementData;

        elementData.textScore = score;

        const childElements = $element.children();
        if (childElements.length === 0) {
            elementData.text = elementText;
            return elementData;
        }

        const children = [];
        let hasViableChild = false;
        $element.children().each(function () {
            const index = $(this).prevAll(this.tagName).length || 0;
            const result = searchElement(this.tagName, $(this));
            children.push({ ...result, index });
            if (result.text || result.children) hasViableChild = true;
        });
        if (hasViableChild) {
            elementData.children = children;
            return elementData;
        }
        elementData.text = elementText;
        return elementData;
    }

    findPath(currentPath, item, siblings = 0, siblingClasses = {}) {
        const { findPath, createSelector } = this;
        if (item.text) {
            const selector = createSelector(currentPath, item, siblings);
            this.foundPaths.push({
                selector,
                text: item.text,
                score: (1 + (selector.split('>').length * 0.2)) * item.textScore,
            });
            return;
        }

        const uniqueClasses = item.class && item.class.split(' ').filter((itemClass) => siblingClasses[itemClass] <= 1).join(' ');

        const newPath = concat(currentPath, {
            tag: item.tag,
            id: item.id,
            class: uniqueClasses || undefined,
            nthChild: !uniqueClasses ? item.index : undefined,
        });

        const childrenClasses = item.children.reduce((classes, child) => {
            if (!child.class) return classes;
            const childClasses = child.class.split(' ');
            childClasses.forEach((childClass) => {
                if (!classes[childClass]) classes[childClass] = 1;
                else classes[childClass]++;
            });
            return classes;
        }, {});

        item.children.forEach((child) => {
            if (!child.text && !child.children) return;
            findPath(newPath, child, item.children.length - 1, childrenClasses);
        });
    }

    find(searchFor, ignore) {
        const { $, searchElement, findPath } = this;
        if (!searchFor || !isArray(searchFor)) {
            throw new Error('DOMSearcher requires array of search queries.');
        }

        this.searchFor = searchFor;
        this.normalizedSearch = searchFor.map(searchString => normalize(searchString));
        this.normalizedIgnore = ignore.map(ignoreString => normalize(ignoreString));
        this.foundPaths = [];

        let $body = $('body');
        if (!$body.length) $body = $.root();
        $body = $body.children();
        $body
            .map(function () {
                return searchElement(this.tagName, $(this));
            })
            .get()
            .filter(child => child.text || child.children)
            .forEach((child) => findPath([], child));

        return sortBy(this.foundPaths, ['score']).map(({ selector, text }) => ({ selector, text: text.trim() }));
    }
}

module.exports = DOMSearcher;
