'use strict';

var YouTrackBot = require('./youtrackbot');
var config = require('./bot-config-sample.json');

if (config && config.telegram && config.telegram.projects && config.telegram.projects.length > 0) {
	if (!config.telegram.defaultToken) {
		return console.error('Invalid configuration: Token is not specified.');
	}

	for (let proj of config.telegram.projects) {
		let telToken = proj.token || config.telegram.defaultToken;
		let ytBot = new YouTrackBot(proj.projectName, telToken, proj.chatId, config);
		ytBot.start(function (err, isFinished) {
			if (err) {
				return console.error(proj.projectName, ':', err);
			}
			console.log(`${proj.projectName} done.`);
		});
	}
} else {
	console.warn('No projects to check.');
}