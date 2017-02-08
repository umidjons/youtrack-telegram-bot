# YouTrack Telegram Bot

This application gets updates from YouTrack and publishes them into Telegram Channels.

## Installation

### Install NodeJS

For example, on `ubuntu` one can run following commands to install `node.js`:
```
sudo apt-get install -y build-essential
curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash -
sudo apt-get install nodejs
```

Copy project into some dir, 
from now on we will refer it as `appdir`.
Install dependencies.

```
cd /appdir
npm install
```

Set appropriate configurations in `src/bot-config.json` file.

Create `last` directory in `appdir` folder, make it writable by the application.
It will contain last update time file for each project.

You can run application and check logs with the following commands:
```bash
npm start
tail -f /appdir/app.log
```

Or configure cron task to run bot on each minute like the following:
```bash
*/2 * * * * cd /appdir && /usr/bin/node ./src/app.js >> ./app.log 2>&1
```

It is also possible to run the bot via `pm2` with `cron_restart` option.
Sample configuration for `pm2` may look like to the following:
```json
{
  "name": "youtrack-bot",
  "script": "/appdir/src/app.js",
  "node_args": [
    "--harmony"
  ],
  "env": {
    "DEBUG": "youtrack:*",
    "DEBUG_DEPTH": 10,
    "DEBUG_COLORS": 0
  },
  "log_date_format": "YYYY-MM-DD HH:mm:ss Z",
  "out_file": "/appdir/logs/youtrack_bot.log",
  "error_file": "/appdir/logs/youtrack_bot_error.log",
  "exec_mode": "cluster",
  "instances": 1,
  "cron_restart": "*/2 * * * *"
}
```

Run command maybe something like this:
```bash
sudo pm2 start /appdir/src/app.json
```

## Configuration

You can assign each project to own Telegram Channel via `chatId`.

If the channel is public, `chatId` may contain channel name, like `@myPublicChannel`.

If the channel is private, then make a channel public, send a test request to the channel from the browser like the following:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage?chat_id=@myTemporaryPublicChannel&text=test
https://api.telegram.org/bot258108210:BAFN7INaQc0MP1GlDe9SxCm-cjc0hz-zWdw/sendMessage?chat_id=@myTemporaryPublicChannel&text=test
```

After that you can make channel private again.

Response will contain the channel's numeric ID, like the following:
```json
{
  "ok": true,
  "result": {
    "message_id": 2,
    "chat": {
      "id": -1001072411791,
      "title": "myTemporaryPublicChannel",
      "username": "myTemporaryPublicChannel",
      "type": "channel"
    },
    "date": 1472985422,
    "text": "test"
  }
}
```

In the above example `-1001072411791` is the channel ID.

`authType` accepts `oauth2`.

Demo configuration is here:
```json
{
	"youtrack": {
		"authType": "oauth2",
		"oauth2": {
			"url": "https://myorgatization.myjetbrains.com/hub/api/rest/oauth2/token",
			"clientServiceId": "7fec3de9-0040-43c9-bf3e-3c4a2250ba02",
			"clientServiceSecret": "73f1de76-9ece-4408-85d3-cf683a0a614e",
			"scope": "7fec3de9-0040-43c9-bf3e-3c4a2250ba02"
		}
	},
	"telegram": {
		"defaultToken": "258108210:BAFN7INaQc0MP1GlDe9SxCm-cjc0hz-zWdw",
		"projects": [
			{
				"token": "555108275:AAFN7INaQc0MP1GlAe9SxCm-cjc0hz-zAdw",
				"projectName": "PROJ1_ID_FROM_YOUTRACK",
				"chatId": "-1001072411791"
			},
			{
				"token": "111108275:AAFN7INaQc0MP1GlAe9SxCm-cjc0hz-zAdw",
				"projectName": "PROJ2_ID_FROM_YOUTRACK",
				"chatId": "-1001072411792"
			}
		]
	}
}
```

`defaultToken` - Telegram Token for all projects, that doesn't have own token.

`projects.token` - Telegram Token for the specific project.

`projectName` - project ID from YouTrack.
