'use strict';

var TBot = require('node-telegram-bot-api');
var moment = require('moment');
var fs = require('fs');
var path = require('path');
var YouTrack = require('./youtrack');

const DATETIME_FORMAT = 'DD.MM.YYYY HH:mm:ss';

class YouTrackBot {
	constructor(project, tel_token, tel_chat_id, config) {
		this.config = config;

		this.projectName = project;
		this.file = `last/${this.projectName}_last_request.json`;
		this.youtrackIssueBaseUrl = `${config.youtrack.baseUrl}/issue/`;

		if (this.config.youtrack.authType == 'credentials') {
			this.youtrack_user = this.config.youtrack.credentials.username;
			this.youtrack_pswd = this.config.youtrack.credentials.password;
		}

		this.telegram = {};
		this.telegram.token = tel_token;
		this.telegram.chat_id = tel_chat_id;
		this.telegram.pending = 0;

		this.bot = new TBot(this.telegram.token);
	}

	_process(cb) {
		let max = this.config.telegram.max || 100;
		this._updatedAfter((err, updatedAfter) => {
			if (err) {
				return cb(err);
			}

			this.yt.issuesHistory(
				this.projectName,
				{
					updatedAfterTimestamp: updatedAfter.ts,
					max: max
				},
				(err, issues) => {
					if (err) {
						return cb(err);
					}

					this.issues = issues;

					if (!issues || issues.length == 0) {
						return this.callbackStart(null, true);
					}

					this.send();
				}
			);
		});
	}

	start(cb) {
		this.callbackStart = cb;
		this.yt = new YouTrack(this.config);

		switch (this.config.youtrack.authType) {
			case 'credentials':
				this.yt.login(this.youtrack_user, this.youtrack_pswd, (err) => {
					if (err) {
						return cb(err);
					}

					this._process(cb);
				});
				break;

			case 'oauth2':
				this.yt.getAccessToken((err) => {
					if (err) {
						return cb(err);
					}

					this._process(cb);
				});
				break;
		}
	}

	send() {
		for (let issue of this.issues) {
			let issue_description = issue.description ? `\n<pre>${issue.description}</pre>` : '';

			// generate issue's URL
			let issue_url = `${this.youtrackIssueBaseUrl}${issue.id}`;

			// operation: created | updated
			let issue_operation = 'created';

			// generate links to attachments
			let attachments = '';
			if (issue.attachments && issue.attachments instanceof Array && issue.attachments.length > 0) {
				attachments += '\n<i>Attachments:</i>\n';
				for (let att of issue.attachments) {
					attachments += `<a href="${att.url}">${att.value}</a>\n`;
				}
			}

			if (!issue.changes || issue.changes.length == 0) { // operation = create

				// build message text
				let msg = `<b>${issue.updaterName}</b> ${issue_operation} <a href="${issue_url}">${issue.id}</a> ${issue.summary} ${issue_description} ${attachments}`;

				// increment pending messages count
				this.telegram.pending++;

				// send message into chat
				this._sendOneMsg(msg);
			} else { // operation = update
				for (let change of issue.changes) {
					let changed_fields = '';

					// Normalize all changed fields
					if (change.changedFields && change.changedFields.length > 0) {
						for (let chf of change.changedFields) {
							let old_val = change[chf].oldValue;
							let new_val = change[chf].newValue;

							// if changed field is 'resolved', then convert its value from timestamp to normal date time
							if (chf == 'resolved' && change[chf].newValue) { // process date time
								new_val = moment(1 * change[chf].newValue).format(DATETIME_FORMAT);
							} else if (chf == 'links' && change[chf].newValue) { // process links
								let link = change[chf].newValue;
								if ('type' in link && link.type && 'role' in link && link.role) {
									new_val = `${link.role} ${link.value}`;
								} else {
									new_val = '';
									for (let prop in link) {
										new_val += `${prop} = ${link[prop]}\n`;
									}
								}
							}

							// take into account the field, if its old or new value exists
							if (old_val || new_val) {
								changed_fields += `\n<i>${chf}: ${old_val} -> ${new_val}</i>`;
							}
						}
					}

					// if control is here, then operation is update
					issue_operation = 'updated';

					// build message text
					let msg = `<b>${change.updaterName}</b> ${issue_operation} <a href="${issue_url}">${issue.id}</a> ${issue.summary} ${issue_description} ${changed_fields} ${attachments}`;

					// increment pending messages count
					this.telegram.pending++;

					// send message into chat
					this._sendOneMsg(msg);
				}
			}
		}
	}

	_sendOneMsg(msg) {
		// send message into chat
		this.bot.sendMessage(this.telegram.chat_id, msg, {parse_mode: 'html'})
			.then(
				(resp) => {
					this.telegram.pending--;
					console.log('Message has been sent>', msg);
					this.checkPending();
				},
				(error) => {
					this.telegram.pending--;
					console.error('Telegram error>', error);
					this.checkPending();
				}
			);
	}

	checkPending() {
		if (this.telegram.pending <= 0) {
			console.log('The Bot has finished sending the messages.');

			this._saveUpdatedAfter((err, last) => {
				if (err) {
					return this.callbackStart(err);
				}

				console.log('New updated after saved:', last);
				this.callbackStart(null, true);
			});

			return true;
		}

		return false;
	}

	_updatedAfter(cb) {
		let now = moment().subtract(10, 'days');
		let default_last = {ts: now.format('x'), s: now.format(DATETIME_FORMAT)};

		let last = null;

		fs.stat(this.file, (err, stat) => {
			if (err) {
				if (err.code == 'ENOENT') {
					last = default_last;
					return cb(null, last);
				} else {
					return cb(err);
				}
			}

			fs.readFile(this.file, (err, data) => {
				if (err) {
					return cb(err);
				}

				last = JSON.parse(data);
				return cb(null, last);
			});
		});
	}

	_saveUpdatedAfter(cb) {
		let now = moment();
		let last = JSON.stringify({ts: now.format('x'), s: now.format(DATETIME_FORMAT)});
		fs.writeFile(this.file, last, (err) => {
			if (err) {
				return cb(err);
			}

			cb(null, last);
		});
	}
}

module.exports = YouTrackBot;