
//  ---------------------------------------------------------------------------

import exmoRest from '../exmo.js';
import { NotSupported } from '../base/errors.js';
import { ArrayCache, ArrayCacheBySymbolById } from '../base/ws/Cache.js';
import { sha512 } from '../static_dependencies/noble-hashes/sha512.js';
import type { Int, Str, OrderBook, Trade, Ticker, Balances, Market, Dict, Strings, Tickers, Order } from '../base/types.js';
import Client from '../base/ws/Client.js';

//  ---------------------------------------------------------------------------

export default class exmo extends exmoRest {
    describe (): any {
        return this.deepExtend (super.describe (), {
            'has': {
                'ws': true,
                'watchBalance': true,
                'watchTicker': true,
                'watchTickers': true,
                'watchTrades': true,
                'watchMyTrades': true,
                'watchOrders': true,
                'watchOrderBook': true,
                'watchOHLCV': false,
            },
            'urls': {
                'api': {
                    'ws': {
                        'public': 'wss://ws-api.exmo.com:443/v1/public',
                        'spot': 'wss://ws-api.exmo.com:443/v1/private',
                        'margin': 'wss://ws-api.exmo.com:443/v1/margin/private',
                    },
                },
            },
            'options': {
            },
            'streaming': {
            },
            'exceptions': {
            },
        });
    }

    requestId () {
        const requestId = this.sum (this.safeInteger (this.options, 'requestId', 0), 1);
        this.options['requestId'] = requestId;
        return requestId;
    }

    /**
     * @method
     * @name exmo#watchBalance
     * @description watch balance and get the amount of funds available for trading or funds locked in orders
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object} a [balance structure]{@link https://docs.ccxt.com/#/?id=balance-structure}
     */
    async watchBalance (params = {}): Promise<Balances> {
        await this.authenticate (params);
        const [ type, query ] = this.handleMarketTypeAndParams ('watchBalance', undefined, params);
        const messageHash = 'balance:' + type;
        const url = this.urls['api']['ws'][type];
        const subscribe: Dict = {
            'method': 'subscribe',
            'topics': [ type + '/wallet' ],
            'id': this.requestId (),
        };
        const request = this.deepExtend (subscribe, query);
        return await this.watch (url, messageHash, request, messageHash, request);
    }

    handleBalance (client: Client, message) {
        //
        //  spot
        //     {
        //         "ts": 1654208766007,
        //         "event": "snapshot",
        //         "topic": "spot/wallet",
        //         "data": {
        //             "balances": {
        //                 "ADA": "0",
        //                 "ALGO": "0",
        //                 ...
        //             },
        //             "reserved": {
        //                 "ADA": "0",
        //                 "ALGO": "0",
        //                 ...
        //             }
        //         }
        //     }
        //
        //  margin
        //     {
        //         "ts": 1624370076651,
        //         "event": "snapshot",
        //         "topic": "margin/wallets",
        //         "data": {
        //             "RUB": {
        //                 "balance": "1000000",
        //                 "used": "0",
        //                 "free": "1000000"
        //             },
        //             "USD": {
        //                 "balance": "1000000",
        //                 "used": "1831.925",
        //                 "free": "998168.075"
        //             }
        //         }
        //     }
        //     {
        //         "ts": 1624370185720,
        //         "event": "update",
        //         "topic": "margin/wallets",
        //         "data": {
        //             "USD": {
        //                 "balance": "1000123",
        //                 "used": "1831.925",
        //                 "free": "998291.075"
        //             }
        //         }
        //     }
        //
        const topic = this.safeString (message, 'topic');
        const parts = topic.split ('/');
        const type = this.safeString (parts, 0);
        if (type === 'spot') {
            this.parseSpotBalance (message);
        } else if (type === 'margin') {
            this.parseMarginBalance (message);
        }
        const messageHash = 'balance:' + type;
        client.resolve (this.balance, messageHash);
    }

    parseSpotBalance (message) {
        //
        //     {
        //         "balances": {
        //             "BTC": "3",
        //             "USD": "1000",
        //             "RUB": "0"
        //         },
        //         "reserved": {
        //             "BTC": "0.5",
        //             "DASH": "0",
        //             "RUB": "0"
        //         }
        //     }
        //
        const event = this.safeString (message, 'event');
        const data = this.safeValue (message, 'data');
        this.balance['info'] = data;
        if (event === 'snapshot') {
            const balances = this.safeValue (data, 'balances', {});
            const reserved = this.safeValue (data, 'reserved', {});
            const currencies = Object.keys (balances);
            for (let i = 0; i < currencies.length; i++) {
                const currencyId = currencies[i];
                const code = this.safeCurrencyCode (currencyId);
                const account = this.account ();
                account['free'] = this.safeString (balances, currencyId);
                account['used'] = this.safeString (reserved, currencyId);
                this.balance[code] = account;
            }
        } else if (event === 'update') {
            const currencyId = this.safeString (data, 'currency');
            const code = this.safeCurrencyCode (currencyId);
            const account = this.account ();
            account['free'] = this.safeString (data, 'balance');
            account['used'] = this.safeString (data, 'reserved');
            this.balance[code] = account;
        }
        this.balance = this.safeBalance (this.balance);
    }

    parseMarginBalance (message) {
        //
        //     {
        //         "RUB": {
        //             "balance": "1000000",
        //             "used": "0",
        //             "free": "1000000"
        //         },
        //         "USD": {
        //             "balance": "1000000",
        //             "used": "1831.925",
        //             "free": "998168.075"
        //         }
        //     }
        //
        const data = this.safeValue (message, 'data');
        this.balance['info'] = data;
        const currencies = Object.keys (data);
        for (let i = 0; i < currencies.length; i++) {
            const currencyId = currencies[i];
            const code = this.safeCurrencyCode (currencyId);
            const wallet = this.safeValue (data, currencyId);
            const account = this.account ();
            account['free'] = this.safeString (wallet, 'free');
            account['used'] = this.safeString (wallet, 'used');
            account['total'] = this.safeString (wallet, 'balance');
            this.balance[code] = account;
            this.balance = this.safeBalance (this.balance);
        }
    }

    /**
     * @method
     * @name exmo#watchTicker
     * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for a specific market
     * @see https://documenter.getpostman.com/view/10287440/SzYXWKPi#fd8f47bc-8517-43c0-bb60-1d61a86d4471
     * @param {string} symbol unified symbol of the market to fetch the ticker for
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/#/?id=ticker-structure}
     */
    async watchTicker (symbol: string, params = {}): Promise<Ticker> {
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.urls['api']['ws']['public'];
        const messageHash = 'ticker:' + symbol;
        const message: Dict = {
            'method': 'subscribe',
            'topics': [
                'spot/ticker:' + market['id'],
            ],
            'id': this.requestId (),
        };
        const request = this.deepExtend (message, params);
        return await this.watch (url, messageHash, request, messageHash, request);
    }

    /**
     * @method
     * @name exmo#watchTickers
     * @description watches a price ticker, a statistical calculation with the information calculated over the past 24 hours for all markets of a specific list
     * @see https://documenter.getpostman.com/view/10287440/SzYXWKPi#fd8f47bc-8517-43c0-bb60-1d61a86d4471
     * @param {string[]} [symbols] unified symbol of the market to fetch the ticker for
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object} a [ticker structure]{@link https://docs.ccxt.com/#/?id=ticker-structure}
     */
    async watchTickers (symbols: Strings = undefined, params = {}): Promise<Tickers> {
        await this.loadMarkets ();
        symbols = this.marketSymbols (symbols, undefined, false);
        const messageHashes = [];
        const args = [];
        for (let i = 0; i < symbols.length; i++) {
            const market = this.market (symbols[i]);
            messageHashes.push ('ticker:' + market['symbol']);
            args.push ('spot/ticker:' + market['id']);
        }
        const url = this.urls['api']['ws']['public'];
        const message: Dict = {
            'method': 'subscribe',
            'topics': args,
            'id': this.requestId (),
        };
        const request = this.deepExtend (message, params);
        await this.watchMultiple (url, messageHashes, request, messageHashes, request);
        return this.filterByArray (this.tickers, 'symbol', symbols);
    }

    handleTicker (client: Client, message) {
        //
        //  spot
        //      {
        //          "ts": 1654205085473,
        //          "event": "update",
        //          "topic": "spot/ticker:BTC_USDT",
        //          "data": {
        //              "buy_price": "30285.84",
        //              "sell_price": "30299.97",
        //              "last_trade": "30295.01",
        //              "high": "30386.7",
        //              "low": "29542.76",
        //              "avg": "29974.16178449",
        //              "vol": "118.79538518",
        //              "vol_curr": "3598907.38200826",
        //              "updated": 1654205084
        //          }
        //      }
        //
        const topic = this.safeString (message, 'topic');
        const topicParts = topic.split (':');
        const marketId = this.safeString (topicParts, 1);
        const symbol = this.safeSymbol (marketId);
        const ticker = this.safeValue (message, 'data', {});
        const market = this.safeMarket (marketId);
        const parsedTicker = this.parseTicker (ticker, market);
        const messageHash = 'ticker:' + symbol;
        this.tickers[symbol] = parsedTicker;
        client.resolve (parsedTicker, messageHash);
    }

    /**
     * @method
     * @name exmo#watchTrades
     * @description get the list of most recent trades for a particular symbol
     * @param {string} symbol unified symbol of the market to fetch trades for
     * @param {int} [since] timestamp in ms of the earliest trade to fetch
     * @param {int} [limit] the maximum amount of trades to fetch
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object[]} a list of [trade structures]{@link https://docs.ccxt.com/#/?id=public-trades}
     */
    async watchTrades (symbol: string, since: Int = undefined, limit: Int = undefined, params = {}): Promise<Trade[]> {
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.urls['api']['ws']['public'];
        const messageHash = 'trades:' + symbol;
        const message: Dict = {
            'method': 'subscribe',
            'topics': [
                'spot/trades:' + market['id'],
            ],
            'id': this.requestId (),
        };
        const request = this.deepExtend (message, params);
        const trades = await this.watch (url, messageHash, request, messageHash, request);
        return this.filterBySinceLimit (trades, since, limit, 'timestamp', true);
    }

    handleTrades (client: Client, message) {
        //
        //      {
        //          "ts": 1654206084001,
        //          "event": "update",
        //          "topic": "spot/trades:BTC_USDT",
        //          "data": [{
        //              "trade_id": 389704729,
        //              "type": "sell",
        //              "price": "30310.95",
        //              "quantity": "0.0197",
        //              "amount": "597.125715",
        //              "date": 1654206083
        //          }]
        //      }
        //
        const topic = this.safeString (message, 'topic');
        const parts = topic.split (':');
        const marketId = this.safeString (parts, 1);
        const symbol = this.safeSymbol (marketId);
        const market = this.safeMarket (marketId);
        const trades = this.safeValue (message, 'data', []);
        const messageHash = 'trades:' + symbol;
        let stored = this.safeValue (this.trades, symbol);
        if (stored === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            stored = new ArrayCache (limit);
            this.trades[symbol] = stored;
        }
        for (let i = 0; i < trades.length; i++) {
            const trade = trades[i];
            const parsed = this.parseTrade (trade, market);
            stored.append (parsed);
        }
        this.trades[symbol] = stored;
        client.resolve (this.trades[symbol], messageHash);
    }

    /**
     * @method
     * @name exmo#watchMyTrades
     * @description get the list of trades associated with the user
     * @param {string} symbol unified symbol of the market to fetch trades for
     * @param {int} [since] timestamp in ms of the earliest trade to fetch
     * @param {int} [limit] the maximum amount of trades to fetch
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object[]} a list of [trade structures]{@link https://docs.ccxt.com/#/?id=public-trades}
     */
    async watchMyTrades (symbol: Str = undefined, since: Int = undefined, limit: Int = undefined, params = {}): Promise<Trade[]> {
        await this.loadMarkets ();
        await this.authenticate (params);
        const [ type, query ] = this.handleMarketTypeAndParams ('watchMyTrades', undefined, params);
        const url = this.urls['api']['ws'][type];
        let messageHash = undefined;
        if (symbol === undefined) {
            messageHash = 'myTrades:' + type;
        } else {
            const market = this.market (symbol);
            symbol = market['symbol'];
            messageHash = 'myTrades:' + market['symbol'];
        }
        const message: Dict = {
            'method': 'subscribe',
            'topics': [
                type + '/user_trades',
            ],
            'id': this.requestId (),
        };
        const request = this.deepExtend (message, query);
        const trades = await this.watch (url, messageHash, request, messageHash, request);
        return this.filterBySymbolSinceLimit (trades, symbol, since, limit, true);
    }

    handleMyTrades (client: Client, message) {
        //
        //  spot
        //     {
        //         "ts": 1654210290219,
        //         "event": "update",
        //         "topic": "spot/user_trades",
        //         "data": {
        //             "trade_id": 389715807,
        //             "type": "buy",
        //             "price": "30527.77",
        //             "quantity": "0.0001",
        //             "amount": "3.052777",
        //             "date": 1654210290,
        //             "order_id": 27352777112,
        //             "client_id": 0,
        //             "pair": "BTC_USDT",
        //             "exec_type": "taker",
        //             "commission_amount": "0.0000001",
        //             "commission_currency": "BTC",
        //             "commission_percent": "0.1"
        //         }
        //     }
        //
        //  margin
        //     {
        //         "ts":1624369720168,
        //         "event":"snapshot",
        //         "topic":"margin/user_trades",
        //         "data":[
        //            {
        //               "trade_id":"692844278081167054",
        //               "trade_dt":"1624369773990729200",
        //               "type":"buy",
        //               "order_id":"692844278081167033",
        //               "pair":"BTC_USD",
        //               "quantity":"0.1",
        //               "price":"36638.5",
        //               "is_maker":false
        //            }
        //         ]
        //     }
        //     {
        //         "ts":1624370368612,
        //         "event":"update",
        //         "topic":"margin/user_trades",
        //         "data":{
        //            "trade_id":"692844278081167693",
        //            "trade_dt":"1624370368569092500",
        //            "type":"buy",
        //            "order_id":"692844278081167674",
        //            "pair":"BTC_USD",
        //            "quantity":"0.1",
        //            "price":"36638.5",
        //            "is_maker":false
        //         }
        //     }
        //
        const topic = this.safeString (message, 'topic');
        const parts = topic.split ('/');
        const type = this.safeString (parts, 0);
        const messageHash = 'myTrades:' + type;
        const event = this.safeString (message, 'event');
        let rawTrades = [];
        let myTrades = undefined;
        if (this.myTrades === undefined) {
            const limit = this.safeInteger (this.options, 'tradesLimit', 1000);
            myTrades = new ArrayCacheBySymbolById (limit);
            this.myTrades = myTrades;
        } else {
            myTrades = this.myTrades;
        }
        if (event === 'snapshot') {
            rawTrades = this.safeValue (message, 'data', []);
        } else if (event === 'update') {
            const rawTrade = this.safeValue (message, 'data', {});
            rawTrades = [ rawTrade ];
        }
        const trades = this.parseTrades (rawTrades);
        const symbols: Dict = {};
        for (let j = 0; j < trades.length; j++) {
            const trade = trades[j];
            myTrades.append (trade);
            symbols[trade['symbol']] = true;
        }
        const symbolKeys = Object.keys (symbols);
        for (let i = 0; i < symbolKeys.length; i++) {
            const symbol = symbolKeys[i];
            const symbolSpecificMessageHash = 'myTrades:' + symbol;
            client.resolve (myTrades, symbolSpecificMessageHash);
        }
        client.resolve (myTrades, messageHash);
    }

    /**
     * @method
     * @name exmo#watchOrderBook
     * @description watches information on open orders with bid (buy) and ask (sell) prices, volumes and other data
     * @param {string} symbol unified symbol of the market to fetch the order book for
     * @param {int} [limit] the maximum amount of order book entries to return
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object} A dictionary of [order book structures]{@link https://docs.ccxt.com/#/?id=order-book-structure} indexed by market symbols
     */
    async watchOrderBook (symbol: string, limit: Int = undefined, params = {}): Promise<OrderBook> {
        await this.loadMarkets ();
        const market = this.market (symbol);
        symbol = market['symbol'];
        const url = this.urls['api']['ws']['public'];
        const messageHash = 'orderbook:' + symbol;
        params = this.omit (params, 'aggregation');
        const subscribe: Dict = {
            'method': 'subscribe',
            'id': this.requestId (),
            'topics': [
                'spot/order_book_updates:' + market['id'],
            ],
        };
        const request = this.deepExtend (subscribe, params);
        const orderbook = await this.watch (url, messageHash, request, messageHash);
        return orderbook.limit ();
    }

    handleOrderBook (client: Client, message) {
        //
        //     {
        //         "ts": 1574427585174,
        //         "event": "snapshot",
        //         "topic": "spot/order_book_updates:BTC_USD",
        //         "data": {
        //             "ask": [
        //                 ["100", "3", "300"],
        //                 ["200", "4", "800"]
        //             ],
        //             "bid": [
        //                 ["99", "2", "198"],
        //                 ["98", "1", "98"]
        //             ]
        //         }
        //     }
        //
        //     {
        //         "ts": 1574427585174,
        //         "event": "update",
        //         "topic": "spot/order_book_updates:BTC_USD",
        //         "data": {
        //             "ask": [
        //                 ["100", "1", "100"],
        //                 ["200", "2", "400"]
        //             ],
        //             "bid": [
        //                 ["99", "1", "99"],
        //                 ["98", "0", "0"]
        //             ]
        //         }
        //     }
        //
        const topic = this.safeString (message, 'topic');
        const parts = topic.split (':');
        const marketId = this.safeString (parts, 1);
        const symbol = this.safeSymbol (marketId);
        const orderBook = this.safeValue (message, 'data', {});
        const messageHash = 'orderbook:' + symbol;
        const timestamp = this.safeInteger (message, 'ts');
        if (!(symbol in this.orderbooks)) {
            this.orderbooks[symbol] = this.orderBook ({});
        }
        const orderbook = this.orderbooks[symbol];
        const event = this.safeString (message, 'event');
        if (event === 'snapshot') {
            const snapshot = this.parseOrderBook (orderBook, symbol, timestamp, 'bid', 'ask');
            orderbook.reset (snapshot);
        } else {
            const asks = this.safeList (orderBook, 'ask', []);
            const bids = this.safeList (orderBook, 'bid', []);
            this.handleDeltas (orderbook['asks'], asks);
            this.handleDeltas (orderbook['bids'], bids);
            orderbook['timestamp'] = timestamp;
            orderbook['datetime'] = this.iso8601 (timestamp);
        }
        client.resolve (orderbook, messageHash);
    }

    handleDelta (bookside, delta) {
        const bidAsk = this.parseBidAsk (delta, 0, 1);
        bookside.storeArray (bidAsk);
    }

    handleDeltas (bookside, deltas) {
        for (let i = 0; i < deltas.length; i++) {
            this.handleDelta (bookside, deltas[i]);
        }
    }

    /**
     * @method
     * @name exmo#watchOrders
     * @see https://documenter.getpostman.com/view/10287440/SzYXWKPi#85f7bc03-b1c9-4cd2-bd22-8fd422272825
     * @see https://documenter.getpostman.com/view/10287440/SzYXWKPi#95e4ed18-1791-4e6d-83ad-cbfe9be1051c
     * @description watches information on multiple orders made by the user
     * @param {string} symbol unified market symbol of the market orders were made in
     * @param {int} [since] the earliest time in ms to fetch orders for
     * @param {int} [limit] the maximum number of order structures to retrieve
     * @param {object} [params] extra parameters specific to the exchange API endpoint
     * @returns {object[]} a list of [order structures]{@link https://docs.ccxt.com/#/?id=order-structure}
     */
    async watchOrders (symbol: Str = undefined, since: Int = undefined, limit: Int = undefined, params = {}): Promise<Order[]> {
        await this.loadMarkets ();
        await this.authenticate (params);
        const [ type, query ] = this.handleMarketTypeAndParams ('watchOrders', undefined, params);
        const url = this.urls['api']['ws'][type];
        let messageHash = undefined;
        if (symbol === undefined) {
            messageHash = 'orders:' + type;
        } else {
            const market = this.market (symbol);
            symbol = market['symbol'];
            messageHash = 'orders:' + market['symbol'];
        }
        const message: Dict = {
            'method': 'subscribe',
            'topics': [
                type + '/orders',
            ],
            'id': this.requestId (),
        };
        const request = this.deepExtend (message, query);
        const orders = await this.watch (url, messageHash, request, messageHash, request);
        return this.filterBySymbolSinceLimit (orders, symbol, since, limit, true);
    }

    handleOrders (client: Client, message) {
        //
        //  spot
        // {
        //     "ts": 1574427585174,
        //     "event": "snapshot",
        //     "topic": "spot/orders",
        //     "data": [
        //       {
        //         "order_id": "14",
        //         "client_id":"100500",
        //         "created": "1574427585",
        //         "pair": "BTC_USD",
        //         "price": "7750",
        //         "quantity": "0.1",
        //         "amount": "775",
        //         "original_quantity": "0.1",
        //         "original_amount": "775",
        //         "type": "sell",
        //         "status": "open"
        //       }
        //     ]
        // }
        //
        //  margin
        // {
        //     "ts":1624371281773,
        //     "event":"snapshot",
        //     "topic":"margin/orders",
        //     "data":[
        //        {
        //           "order_id":"692844278081168665",
        //           "created":"1624371250919761600",
        //           "type":"limit_buy",
        //           "previous_type":"limit_buy",
        //           "pair":"BTC_USD",
        //           "leverage":"2",
        //           "price":"10000",
        //           "stop_price":"0",
        //           "distance":"0",
        //           "trigger_price":"10000",
        //           "init_quantity":"0.1",
        //           "quantity":"0.1",
        //           "funding_currency":"USD",
        //           "funding_quantity":"1000",
        //           "funding_rate":"0",
        //           "client_id":"111111",
        //           "expire":0,
        //           "src":1,
        //           "comment":"comment1",
        //           "updated":1624371250938136600,
        //           "status":"active"
        //        }
        //     ]
        // }
        //
        const topic = this.safeString (message, 'topic');
        const parts = topic.split ('/');
        const type = this.safeString (parts, 0);
        const messageHash = 'orders:' + type;
        const event = this.safeString (message, 'event');
        if (this.orders === undefined) {
            const limit = this.safeInteger (this.options, 'ordersLimit', 1000);
            this.orders = new ArrayCacheBySymbolById (limit);
        }
        const cachedOrders = this.orders;
        let rawOrders = [];
        if (event === 'snapshot') {
            rawOrders = this.safeValue (message, 'data', []);
        } else if (event === 'update') {
            const rawOrder = this.safeDict (message, 'data', {});
            rawOrders.push (rawOrder);
        }
        const symbols: Dict = {};
        for (let j = 0; j < rawOrders.length; j++) {
            const order = this.parseWsOrder (rawOrders[j]);
            cachedOrders.append (order);
            symbols[order['symbol']] = true;
        }
        const symbolKeys = Object.keys (symbols);
        for (let i = 0; i < symbolKeys.length; i++) {
            const symbol = symbolKeys[i];
            const symbolSpecificMessageHash = 'orders:' + symbol;
            client.resolve (cachedOrders, symbolSpecificMessageHash);
        }
        client.resolve (cachedOrders, messageHash);
    }

    parseWsOrder (order: Dict, market: Market = undefined): Order {
        //
        // {
        //     order_id: '43226756791',
        //     client_id: 0,
        //     created: '1730371416',
        //     type: 'market_buy',
        //     pair: 'TRX_USD',
        //     quantity: '0',
        //     original_quantity: '30',
        //     status: 'cancelled',
        //     last_trade_id: '726480870',
        //     last_trade_price: '0.17',
        //     last_trade_quantity: '30'
        // }
        //
        const id = this.safeString (order, 'order_id');
        const timestamp = this.safeTimestamp (order, 'created');
        const orderType = this.safeString (order, 'type');
        const side = this.parseSide (orderType);
        const marketId = this.safeString (order, 'pair');
        market = this.safeMarket (marketId, market);
        const symbol = market['symbol'];
        let amount = this.safeString (order, 'quantity');
        if (amount === undefined) {
            const amountField = (side === 'buy') ? 'in_amount' : 'out_amount';
            amount = this.safeString (order, amountField);
        }
        const price = this.safeString (order, 'price');
        const clientOrderId = this.omitZero (this.safeString (order, 'client_id'));
        const triggerPrice = this.omitZero (this.safeString (order, 'stop_price'));
        let type = undefined;
        if ((orderType !== 'buy') && (orderType !== 'sell')) {
            type = orderType;
        }
        let trades = undefined;
        if ('last_trade_id' in order) {
            const trade = this.parseWsTrade (order, market);
            trades = [ trade ];
        }
        return this.safeOrder ({
            'id': id,
            'clientOrderId': clientOrderId,
            'datetime': this.iso8601 (timestamp),
            'timestamp': timestamp,
            'lastTradeTimestamp': undefined,
            'status': this.parseStatus (this.safeString (order, 'status')),
            'symbol': symbol,
            'type': type,
            'timeInForce': undefined,
            'postOnly': undefined,
            'side': side,
            'price': price,
            'stopPrice': triggerPrice,
            'triggerPrice': triggerPrice,
            'cost': undefined,
            'amount': this.safeString (order, 'original_quantity'),
            'filled': undefined,
            'remaining': this.safeString (order, 'quantity'),
            'average': undefined,
            'trades': trades,
            'fee': undefined,
            'info': order,
        }, market);
    }

    parseWsTrade (trade: Dict, market: Market = undefined): Trade {
        const id = this.safeString (trade, 'order_id');
        const orderType = this.safeString (trade, 'type');
        const side = this.parseSide (orderType);
        const marketId = this.safeString (trade, 'pair');
        market = this.safeMarket (marketId, market);
        const symbol = market['symbol'];
        let type = undefined;
        if ((orderType !== 'buy') && (orderType !== 'sell')) {
            type = orderType;
        }
        return this.safeTrade ({
            'id': this.safeString (trade, 'last_trade_id'),
            'symbol': symbol,
            'order': id,
            'type': type,
            'side': side,
            'price': this.safeString (trade, 'last_trade_price'),
            'amount': this.safeString (trade, 'last_trade_quantity'),
            'cost': undefined,
            'fee': undefined,
        }, market);
    }

    handleMessage (client: Client, message) {
        //
        // {
        //     "ts": 1654206362552,
        //     "event": "info",
        //     "code": 1,
        //     "message": "connection established",
        //     "session_id": "7548931b-c2a4-45dd-8d71-877881a7251a"
        // }
        //
        // {
        //     "ts": 1654206491399,
        //     "event": "subscribed",
        //     "id": 1,
        //     "topic": "spot/ticker:BTC_USDT"
        // }
        const event = this.safeString (message, 'event');
        const events: Dict = {
            'logged_in': this.handleAuthenticationMessage,
            'info': this.handleInfo,
            'subscribed': this.handleSubscribed,
        };
        const eventHandler = this.safeValue (events, event);
        if (eventHandler !== undefined) {
            eventHandler.call (this, client, message);
            return;
        }
        if ((event === 'update') || (event === 'snapshot')) {
            const topic = this.safeString (message, 'topic');
            if (topic !== undefined) {
                const parts = topic.split (':');
                const channel = this.safeString (parts, 0);
                const handlers: Dict = {
                    'spot/ticker': this.handleTicker,
                    'spot/wallet': this.handleBalance,
                    'margin/wallet': this.handleBalance,
                    'margin/wallets': this.handleBalance,
                    'spot/trades': this.handleTrades,
                    'margin/trades': this.handleTrades,
                    'spot/order_book_updates': this.handleOrderBook,
                    'spot/orders': this.handleOrders,
                    'margin/orders': this.handleOrders,
                    'spot/user_trades': this.handleMyTrades,
                    'margin/user_trades': this.handleMyTrades,
                };
                const handler = this.safeValue (handlers, channel);
                if (handler !== undefined) {
                    handler.call (this, client, message);
                    return;
                }
            }
        }
        throw new NotSupported (this.id + ' received an unsupported message: ' + this.json (message));
    }

    handleSubscribed (client: Client, message) {
        //
        // {
        //     "method": "subscribe",
        //     "id": 2,
        //     "topics": ["spot/orders"]
        // }
        //
        return message;
    }

    handleInfo (client: Client, message) {
        //
        // {
        //     "ts": 1654215731659,
        //     "event": "info",
        //     "code": 1,
        //     "message": "connection established",
        //     "session_id": "4c496262-e259-4c27-b805-f20b46209c17"
        // }
        //
        return message;
    }

    handleAuthenticationMessage (client: Client, message) {
        //
        //     {
        //         "method": "login",
        //         "id": 1,
        //         "api_key": "K-************************",
        //         "sign": "******************************************************************",
        //         "nonce": 1654215729887
        //     }
        //
        const messageHash = 'authenticated';
        client.resolve (message, messageHash);
    }

    async authenticate (params = {}) {
        const messageHash = 'authenticated';
        const [ type, query ] = this.handleMarketTypeAndParams ('authenticate', undefined, params);
        const url = this.urls['api']['ws'][type];
        const client = this.client (url);
        let future = this.safeValue (client.subscriptions, messageHash);
        if (future === undefined) {
            const time = this.milliseconds ();
            this.checkRequiredCredentials ();
            const requestId = this.requestId ();
            const signData = this.apiKey + time.toString ();
            const sign = this.hmac (this.encode (signData), this.encode (this.secret), sha512, 'base64');
            const request: Dict = {
                'method': 'login',
                'id': requestId,
                'api_key': this.apiKey,
                'sign': sign,
                'nonce': time,
            };
            const message = this.extend (request, query);
            future = await this.watch (url, messageHash, message, messageHash);
            client.subscriptions[messageHash] = future;
        }
        return future;
    }
}
