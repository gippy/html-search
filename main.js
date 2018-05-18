const http = require('http');
const https = require('https');
const Apify = require('apify');
const { isString } = require('lodash');
const Promise = require('bluebird');
const DOMSearcher = require('./src/DOMSearcher');
const cleanHtml = require('./src/clean-html');

const sendResultsToWebhook = (webhook, response) => {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(response);
        let port = 80;
        let client = http;
        if (webhook.startsWith('https')) {
            webhook = webhook.replace('https://', '');
            port = 443;
            client = https;
        } else if (webhook.startsWith('http')) {
            webhook = webhook.replace('http://', '');
        }

        const webhookParts = webhook.split('/');
        let hostname = webhookParts[0];
        const path = webhookParts.slice(1).join('/');
        const hostnameParts = hostname.split(':');
        if (hostnameParts.length > 1) {
            hostname = hostnameParts[0]; // eslint-disable-line
            port = hostnameParts[1]; // eslint-disable-line
        }
        if (port === 443) client = https;

        const options = {
            hostname,
            port,
            path: `/${path}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };

        console.log('Calling webhook for url', response.url);
        const req = client.request(options, (res) => {
            console.log(`Webhook status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`${chunk}`);
            });

            res.on('end', () => {
                resolve();
            });
        });
        req.on('error', (e) => {
            reject(new Error(`Problem with webhook: ${e.message}`));
        });

        // write data to request body
        req.write(data);
        req.end();
    });
};

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    let { url } = input;
    if (!url) throw new Error('input.url is missing!!!!');

    if (isString(url)) url = [url];

    const requests = url.map(website => ({
        url: website,
        method: 'GET',
        headers: {},
    }));

    const requestList = new Apify.RequestList({
        sources: requests,
        state: await Apify.getValue('request-list-state'),
    });

    await requestList.initialize();

    const gotoFunction = ({ request, page }) => page.goto(request.url, { timeout: 180000, waitUntil: 'networkidle2' });

    const handlePageFunction = async ({ request, page }) => {
        // Delay if provided through INPUT
        if (input.delay) await new Promise(resolve => setTimeout(resolve, input.delay));
        let html = await page.evaluate(() => document.documentElement.innerHTML); // eslint-disable-line
        if (html) {
            html = cleanHtml(html);
            await Apify.setValue('html', html, { contentType: 'text/html' });
            const domSearcher = new DOMSearcher({ html });
            const results = domSearcher.find(input.searchFor, input.ignore);
            if (results && results.length) {
                const response = {
                    _globalId: input._globalId,
                    url: request.url,
                    htmlSearched: new Date(),
                    htmlFound: results,
                };
                await Apify.setValue('OUTPUT', JSON.stringify(response, null, 4), { contentType: 'application/json' });
                await sendResultsToWebhook(input.webhook, response);
                // we only care about first response, kill instance
                process.exit(0);
            }
        }
    };

    const handleFailedRequestFunction = async ({ request }) => {
        console.error(`Failed: ${request.url}`);
        console.error(request);
        console.error(new Date());
    };

    const puppeteerCrawler = new Apify.PuppeteerCrawler({
        requestList,
        minConcurrency: 1,
        maxConcurrency: 1,
        abortInstanceAfterRequestCount: 100,
        maxOpenPagesPerInstance: 150,
        disableProxy: true,
        // groups: ['SHADER'],
        gotoFunction,
        handlePageFunction,
        handleFailedRequestFunction,
        pageOpsTimeoutMillis: 180000,
        puppeteerConfig: { dumpio: false },
    });

    // Killing process every 10 minutes to avoid problems with memory leak and overusage
    setTimeout(() => process.exit(1), 10 * 60 * 1000);

    await puppeteerCrawler.run();
    console.log('Could not find specials in provided urls');
});
