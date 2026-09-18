# ameria vpos + telegram

![ci](https://github.com/quueli/ameria-vpos-telegram/actions/workflows/ci.yml/badge.svg)

telegram bot that takes a payment through ameriabank's vpos api. user picks currency and amount in the bot, gets a link to the bank page, pays, the bot notices and says so.

    npm i
    cp .env.example .env        # merchant client id / user / pass from the bank, bot token
    node bot/index.js           # the bot
    node server/server.js       # back url page + refund/cancel endpoints
