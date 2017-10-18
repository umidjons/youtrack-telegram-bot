'use strict';

const request = require('request-promise');
const debug = require('debug')('youtrack:youtrack');
const moment = require('moment');
const qs = require('querystring');

debug.log = console.log.bind(console);

class Youtrack {
    constructor(config) {
        this.config = config;
        this.baseUrl = this.config.youtrack.baseUrl;
    }

    async issuesChanges(projectName, options = { updatedAfter: moment().subtract(1, 'days').format('x'), max: 10 }) {
        let issues = await this.issuesByProject(projectName, options);
        let issuesWithChanges = [];
        for (let issue of issues) {
            let _issue = await this.issueChanges(issue.id, options.updatedAfter);
            debug('issuesChanges() _issue=', _issue);

            if (_issue.__error)
                continue;

            issuesWithChanges.push(_issue);
        }
        debug('issuesChanges() Count of issues with changes:', issuesWithChanges.length);
        return issuesWithChanges;
    }

    async issuesByProject(projectName, options = { updatedAfter: moment().subtract(1, 'days').format('x'), max: 10 }) {
        let queryParams = {
            updatedAfter: options.updatedAfter,
            max: options.max,
            with: ['updated']
        };

        queryParams = qs.stringify(queryParams);
        let url = `${this.baseUrl}/rest/issue/byproject/${projectName}?${queryParams}`;
        let params = { url: url, headers: this._getHeaders() };
        let response = await request.get(params);
        response = JSON.parse(response);

        debug('issuesByProject() response=%j', response);

        let issueList = [];
        for (let issue of response) {
            if (!issue.id.startsWith(projectName)) {
                debug('issuesByProject() Ignoring invalid issue: ', issue);
                continue;
            }
            let _issue = Object.assign({ id: issue.id }, this._normalizeFields(issue.field));
            issueList.push(_issue);
        }

        debug('issuesByProject() issueList=', issueList);

        return issueList;
    }

    async issueChanges(issueId, updatedAfter) {
        let url = `${this.baseUrl}/rest/issue/${issueId}/changes`;
        let params = { url: url, headers: this._getHeaders() };
        let issue = { changes: [] };

        let response = null;

        try {
            response = await request.get(params);
            response = JSON.parse(response);
        }
        catch (err) {
            issue.__error = err;
            debug('issueChanges() error=', err);
            if (err.statusCode == 404) {
                return issue;
            }
        }

        debug('issueChanges() response=%j', response);

        if (response.issue) {
            // fill issue attributes
            issue.id = response.issue.id;
            let res = this._normalizeFields(response.issue.field);
            Object.assign(issue, res);
        }

        if (response.change) {
            for (let change of response.change) {
                let _change = { changedFields: [] };
                let res = this._normalizeFields(change.field);
                issue.changes.push(res);
            }
        }

        issue.changes = this._changesUpdatedAfter(issue, updatedAfter);

        debug('issueChanges() issue=%O', issue);

        return issue;
    }

    _normalizeFields(fields) {
        let object = {};

        for (let field of fields) {
            if (Array.isArray(field.value)) {

                if (Array.isArray(field.valueId)) {
                    object[field.name] = `${field.value[0]} [${field.valueId[0]}]`;
                } else {
                    object[field.name] = field.value[0].value;
                }

            }
            else if ('oldValue' in field && 'newValue' in field) {

                if (object.changedFields === undefined)
                    object.changedFields = [];

                object.changedFields.push(field.name);

                let oldVal = field.oldValue[0];
                let newVal = field.newValue[0];

                if (field.name.toLowerCase() === 'sprint') {
                    if (typeof oldVal === 'object' && 'id' in oldVal) {
                        oldVal = oldVal.id;
                    }

                    if (typeof newVal === 'object' && 'id' in newVal) {
                        newVal = newVal.id;
                    }
                }

                object[field.name] = { oldValue: oldVal, newValue: newVal };
            }
            else {
                object[field.name] = field.value;
            }
        }

        return object;
    }

    /**
     * Filters out issue changes by updated after timestamp value.
     * @param {object} issue issue instance
     * @param {number} tsUpdated updated after date and time value in timestamp
     * @returns {Array} filtered list of changes, which are updated after given timestamp
     * @private
     */
    _changesUpdatedAfter(issue, tsUpdated) {
        if (!issue || !issue.changes || !tsUpdated) {
            return [];
        }

        return issue.changes.filter(change => {
            debug('_changesUpdatedAfter() issue=', issue, 'change=', change, 'tsUpdated=', tsUpdated, 'change.updated >= tsUpdated ==>', change.updated >= tsUpdated);
            return change.updated >= tsUpdated;
        });
    }

    _getHeaders() {
        let headers = { Accept: 'application/json' };

        // set access token if exists
        if (this.config.youtrack.token)
            headers.Authorization = this.config.youtrack.authType + ' ' + this.config.youtrack.token;

        return headers;
    }
}

module.exports = Youtrack;