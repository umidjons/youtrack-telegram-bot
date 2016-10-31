'use strict';

var qs = require('querystring');
var moment = require('moment');
var async = require('async');

/**
 * Options:
 * config.authType = oauth2 | credentials
 */
class YouTrack {

	constructor(config) {
		this.config = config;
		this.request = require('request').defaults({jar: true});
		this.jar = this.request.jar();
		this.baseUrl = this.config.youtrack.baseUrl;
		this.authCookie = null;
		this.accessToken = null;
	}

	getAccessToken(cb) {
		// generate Base64(CLIENT_SERVICE_ID:CLIENT_SERVICE_SECRET) Authorization value
		let authValue = (new Buffer(this.config.youtrack.oauth2.clientServiceId + ':' + this.config.youtrack.oauth2.clientServiceSecret)).toString('base64');

		let params = {
			url: this.config.youtrack.oauth2.url,
			headers: {
				Accept: 'application/json',
				Authorization: 'Basic ' + authValue
			},
			form: {grant_type: 'client_credentials', scope: this.config.youtrack.oauth2.scope}
		};

		this.request.post(params, (err, resp, body) => {
			if (err) {
				return cb(err, null, resp, body);
			}

			let data = JSON.parse(body);

			if ('error' in data) {
				return cb(Error(data.error_description, data.error_code), null, resp, body);
			}

			this.accessToken = data.access_token;
			this.tokenType = data.token_type;

			cb(null, this.accessToken, resp, body);
		});
	}

	/**
	 * Authorize on YouTrack with given username and password.
	 * @param {string} username login
	 * @param {string} password password
	 * @param {function} cb callback with signature cb(err, authCookie, response, body).
	 */
	login(username, password, cb) {
		var url = `${this.baseUrl}/rest/user/login`;
		var params = {
			url: url,
			form: {login: username, password: password},
			jar: this.jar
		};

		this.request.post(params, (err, resp, body) => {
			if (err) {
				return cb(err, null, resp, body);
			}

			this.authCookie = this.jar.getCookieString(url);

			cb(null, this.authCookie, resp, body);
		});
	}

	/**
	 * Get list of issues for the specified project.
	 * @param {string} project name of the project
	 * @param {object} options options object with the following default value
	 *        {updateAfterTimestamp: '-1 day from now', max: 10}
	 * @param {function} cb callback function with signature cb(err, issues, response, body)
	 */
	issuesByProject(project, options, cb) {
		var defaultUpdatedAfterTimestamp = moment().subtract(1, 'days').format('x');

		var opts = Object.assign({updatedAfterTimestamp: defaultUpdatedAfterTimestamp, max: 10}, options);

		var query_params = {
			max: opts.max,
			updatedAfter: opts.updatedAfterTimestamp,
			with: ['id', 'updated']
		};

		var headers = {Accept: 'application/json'};

		// set access token if exists
		if (this.accessToken) {
			headers.Authorization = this.tokenType + ' ' + this.accessToken;
		}

		var query_params_str = qs.stringify(query_params);
		var url = `${this.baseUrl}/rest/issue/byproject/${project}?${query_params_str}`;

		var params = {url: url, jar: this.jar, headers: headers};

		this.request.get(params, (err, resp, body) => {
			if (err) {
				return cb(err, null, resp, body);
			}

			var issueList = [];
			var issues = JSON.parse(body);
			for (let issue of issues) {
				let _issue = {};
				_issue.id = issue.id;
				issue.field.forEach(function (fld) {
					_issue[fld.name] = fld.value;
				});

				issueList.push(_issue);
			}
			cb(null, issueList, resp, body);
		});
	}

	/**
	 * Get issue instance with changes after specified time.
	 * @param {string} issueId id of the issue
	 * @param {number} updatedAfterTimestamp updated after date and time in timestamp
	 * @param {function} cb callback function with signature cb(err, issue, response, body)
	 */
	issueHistory(issueId, updatedAfterTimestamp, cb) {
		var url = `${this.baseUrl}/rest/issue/${issueId}/changes`;

		var headers = {Accept: 'application/json'};

		// set access token if exists
		if (this.accessToken) {
			headers.Authorization = this.tokenType + ' ' + this.accessToken;
		}

		var params = {url: url, jar: this.jar, headers: headers};
		this.request.get(params, (err, resp, body) => {
			if (err) {
				return cb(err, null, resp, body);
			}

			//return cb(null, JSON.parse(body), resp, body);

			var issue = {changes: []};
			var issueHistory = JSON.parse(body);

			if (issueHistory.issue) {
				// fill issue attributes
				issue.id = issueHistory.issue.id;
				issueHistory.issue.field.forEach(function (fld) {
					issue[fld.name] = fld.value;
				});
			}

			if (issueHistory.change) {// fill changes
				issueHistory.change.forEach(function (change) {
					var _change = {changedFields: []};
					change.field.forEach(function (fld) {
						if ('oldValue' in fld && 'newValue' in fld) {
							_change.changedFields.push(fld.name);
							let oldVal = fld.oldValue[0];
							let newVal = fld.newValue[0];
							if (fld.name.toLowerCase() == 'sprint') {
								if (typeof oldVal == 'object' && 'id' in oldVal) {
									oldVal = oldVal.id;
								}
								if (typeof newVal == 'object' && 'id' in newVal) {
									newVal = newVal.id;
								}
							}
							_change[fld.name] = {oldValue: oldVal, newValue: newVal};
						} else {
							_change[fld.name] = fld.value;
						}
					});
					issue.changes.push(_change);
				});
			}

			issue.changes = this._changesUpdatedAfter(issue, updatedAfterTimestamp);

			cb(null, issue, resp, body);
		});
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

		return issue.changes.filter(function (change) {
			return change.updated >= tsUpdated;
		});
	}

	/**
	 * Get issues with changes.
	 * @param {string} project project name
	 * @param {object} options options object with the following default value
	 *        {updateAfterTimestamp: '-1 day from now', max: 10}
	 * @param {function} cb callback function with signature cb(err, issues)
	 */
	issuesHistory(project, options, cb) {
		this.issuesByProject(project, options, (err, issues, resp, body) => {
			if (err) {
				return cb(err);
			}

			let issue_ids = issues.map(issue => issue.id);

			async.map(
				issue_ids, // list of issue ids

				// iteratee
				(id, cbHistory) => {
					this.issueHistory(id, options.updatedAfterTimestamp, (err, issue) => {
						if (err) {
							return cbHistory(err);
						}
						cbHistory(null, issue);
					});
				},

				// done callback
				(err, results) => {
					if (err) {
						return cb(err);
					}

					// ignore issues without changes or created before the specified date and time (as timestamp)
					results = results.filter((issue) => {
						return issue && ((issue.changes && issue.changes.length > 0) || issue.created >= options.updatedAfterTimestamp);
					});

					cb(null, results);
				}
			);
		});
	}
}

module.exports = YouTrack;