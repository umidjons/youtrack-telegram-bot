'use strict';

const TBot = require('node-telegram-bot-api');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('youtrack:bot');
const Youtrack = require('./youtrack');

debug.log = console.log.bind(console);

const DATETIME_FORMAT = 'DD.MM.YYYY HH:mm:ss';

class YoutrackBot {
    constructor(config, telegramOptions = {token: null, chatId: null}) {
        debug('constructor() config=', config, 'telegramOptions=', telegramOptions);
        this.projectName = telegramOptions.projectName;
        this.config = config;
        this.telegram = Object.assign({token: null, chatId: null}, telegramOptions);
        this.youtrackIssueBaseUrl = `${this.config.youtrack.baseUrl}/issue/`;
        this.file = `last/${this.projectName}_last_request.json`;

        this.bot = new TBot(this.telegram.token);
        debug('constructor() bot created.');
    }

    async start() {
        let max = this.config.telegram.max || 100;

        debug('start() Maximum messages for telegram is:', max);

        this.yt = new Youtrack(this.config);

        let last = await this._getUpdatedAfter();

        this.issues = await this.yt.issuesChanges(this.projectName, {updatedAfter: last.ts, max: max});

        return this._process();
    }

    async _getUpdatedAfter() {
        let now = moment().subtract(10, 'days');
        let default_last = {ts: now.format('x'), s: now.format(DATETIME_FORMAT)};

        let last = null;

        try {
            last = require(`../${this.file}`);
        } catch (err) {
            debug('_getUpdatedAfter() err=', err);
            debug('_getUpdatedAfter() fallback to default value:', default_last);
            last = default_last;
        }

        debug('_getUpdatedAfter() last=', last);

        return last;
    }

    _setUpdatedAfter() {
        let now = moment();
        let last = JSON.stringify({ts: now.format('x'), s: now.format(DATETIME_FORMAT)});

        debug('_setUpdatedAfter() new last value:', last);

        fs.writeFileSync(this.file, last);
    }

    _escape(data) {
        if (!data)
            return data;

        let escaped = data.replace('&', '&amp;');
        escaped = escaped.replace('<', '&lt;');
        escaped = escaped.replace('>', '&gt;');
        return escaped;
    }

    _process() {
        debug('_process() started.');
        return new Promise(async(resolve, reject) => {
            try {

                for (let issue of this.issues) {
                    issue.description = issue.description ? `\n<pre>${this._escape(issue.description)}</pre>` : '';
                    issue.url = `${this.youtrackIssueBaseUrl}${issue.id}`;
                    issue.operation = issue.changes && issue.changes.length > 0 ? 'updated' : 'created'; // operation: created | updated
                    issue.attachments = this._getAttachments(issue);

                    let changedFields = '';
                    if (issue.operation === 'updated') {
                        // send additional message for each change
                        for (let change of issue.changes) {
                            changedFields = this._getChangedFields(change);
                            issue.message = this._getMessage(issue, changedFields, change.updated);
                            issue.sendResult = await this._send(issue.message);
                        }
                    } else {
                        issue.message = this._getMessage(issue, changedFields, issue.created);
                        issue.sendResult = await this._send(issue.message);
                    }
                }

                debug('_process() resolved.');

                this._setUpdatedAfter();

                resolve(this.issues);

            } catch (err) {
                debug('_process() rejected. Error:', err);
                reject(err);
            }
        });
    }

    _getAttachments(issue) {
        debug('_getAttachments() attachments=', issue.attachments);

        let attachments = '';

        if (issue.attachments && Array.isArray(issue.attachments) && issue.attachments.length > 0) {

            attachments += '\n<i>Attachments:</i>\n';

            for (let attachment of issue.attachments) {
                attachments += `<a href="${attachment.url}">${this._escape(attachment.value)}</a>\n`;
            }
        }

        debug('_getAttachments() attachments string=', attachments);

        return attachments;
    }

    _getMessage(issue, changedFields, time) {
        let timeStr = moment(1 * time).format(DATETIME_FORMAT);
        let msg = `<b>${this._escape(issue.updaterName)}</b> ${timeStr} ${issue.operation} <a href="${issue.url}">${issue.id}</a> ${this._escape(issue.summary)} ${issue.description} ${changedFields} ${issue.attachments}`;

        debug('_getMessage() message=', msg);

        return msg;
    }

    _getChangedFields(change) {
        debug('_getChangedFields() change=', change);

        let changedFields = '';

        if (Array.isArray(change.changedFields) && change.changedFields.length > 0) {

            for (let changedField of change.changedFields) {

                let oldVal = change[changedField].oldValue;
                let newVal = change[changedField].newValue;

                if (changedField == 'resolved' && newVal) {
                    newVal = moment(1 * newVal).format(DATETIME_FORMAT);
                }

                if (changedField == 'links' && newVal) {
                    if (newVal.type && newVal.role) {
                        newVal = `${newVal.role} ${newVal.value}`;
                    } else {
                        let link = '';
                        for (let prop in newVal) {
                            link += `${prop} = ${newVal[prop]}`;
                        }
                        newVal = link;
                    }
                }

                if (oldVal || newVal) {
                    changedFields += `\n<i>${changedField}: ${this._escape(oldVal)} -> ${this._escape(newVal)}</i>`;
                }
            }

        }

        debug('_getChangedFields() changedFields=', changedFields);

        return changedFields;
    }

    _send(message) {
        debug('_send() message=', message);
        return this.bot.sendMessage(this.telegram.chatId, message, {parse_mode: 'html'});
    }
}

module.exports = YoutrackBot;