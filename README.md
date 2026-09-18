# ameria vpos + telegram

![ci](https://github.com/quueli/ameria-vpos-telegram/actions/workflows/ci.yml/badge.svg)

telegram bot that takes a payment through ameriabank's vpos api. user picks currency and amount in the bot, gets a link to the bank page, pays, the bot notices and says so.

the interesting part is the "notices" bit: there is no callback you can really rely on, so each order is polled with GetPaymentDetails on an interval until it is paid, declined or the deadline passes. tracking survives a restart (open orders are re-armed from the store on boot) and a terminal state is only handled once.

also, order ids. the first version did `Date.now()*100` which overflows the int32 the bank uses, took me a while to figure out why random orders were getting rejected. now its `(Date.now() % 1e8) * 20 + seq`.

## run

    npm i
    cp .env.example .env        # merchant client id / user / pass from the bank, bot token
    node bot/index.js           # the bot
    node server/server.js       # back url page + refund/cancel endpoints

no bank account handy? `node demo/run-demo.js` walks the whole flow against a stub gateway.

test mode talks to servicestest.ameriabank.am, live to services.ameriabank.am, switched with AMERIA_TEST_MODE.
