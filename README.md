# Cosmos Operator Status, Monitoring and Analytics Dashboard

Or simply COSMAD is a monitoring and analytics solution for validators securing
Cosmos SDK based chains and this also includes Gnoland, chains based on TM2 consensus.

COSMAD provides a full stack solution for tracking signing activity of the validator.

## Project Status

Project is in ALPHA! While it should be stable, it is still under active development,
and could change significantly or contain some bugs.

## Project stack

- _Programming language:_ TypeScript
- _Database:_ DuckDB
- _Runtime:_ Nodejs
- _API:_ REST(Hono)
- _Frontend:_ Vite/Vue

## Intent and purpose of this project

COSMAD aims to provide a comprehensive monitoring and analytics solution for
Cosmos Validators. While there are some other alternatives for this, the most
famous one [Tenderduty](https://github.com/blockpane/tenderduty) it is unmaintained
since 2025. And there was another interesting monitoring solution called [CVMS](https://github.com/cosmostation/cvms)
which was maintained by the Cosmostation, but since they have been bought out
by Cosmos Labs the maintenance of this tool will probably be discontinued.

There have been some attempts to fork Tenderduty by some teams, but not many new
features were added to the forks.

Cosmad should provide a slightly different experience than these tools and to try
to extend beyond just monitoring and some simple dashboards.

A lot of these tools do not provide any sort of analytics, they only provide
latest validator status. You cannot compare the status of a validator at
different points in time, there is no history in most cases, you either have to
query the blockchain node directly to collect this data.

## Cosmad vs Tenderduty

To understand what this tool tries to achieve a simple comparison might be helpful:

| Feature              | Cosmad                  | Tenderduty                 |
| -------------------- | ----------------------- | -------------------------- |
| Programming Language | TypeScript              | Golang                     |
| Query Method         | Pull (REST and RPC)     | Pull and Push (WS and RPC) |
| State                | Database (DuckDB)       | Almost stateless           |
| Access to state      | REST(Hono), Unix Socket | None                       |

### Similarities

Setting up configuration for both is almost identical since Tenderduty
served as a reference, the difference might be usage of TOML vs YAML.
Alerts are also almost identical, with Cosmad only lacking support for Slack.

Both provide a dashboard option to view current state of operations.

### Differences

#### Programming Language

While Go is superior in terms of performance and concurrency, TypeScript might be
more convenient for more developers (typescript is a bit easier to work with).
Most of the processes are I/O bound and shouldn't be too CPU-intensive and
should be fine for NodeJS.

#### Query Methods

Query methods and the way they fetch data is very different. The reason for this
is that some blockchain node runners do not server WebSocket or do not have
correct settings turned on when they proxy it. While there are some legitimate
reasons to not serve WebSocket publicly (e.g. harder to rate limit) the lack of
this endpoint provides no way to properly monitor the validator node with Tenderduty.
While this is out of scope for Cosmad, on how validator runs their infrastructure,
having option to hook up to any public REST and RPC endpoint should provide easier
and more reliable monitoring.

The _cons_ for this option is if you do use rate limited endpoints they might block
Cosmad from collecting the data. However if you use multiple endpoints it should
be able to collect data from multiple sources and avoid being blocked.

Another important info is that since Cosmad can't fetch data about missing, prevotes
and precommits. There are only 3 possible outcome, you were in the inacitive set,
missed or signed the block.

#### Chain State Tracking

The way they store the data and track chain state differ greatly.

Tenderduty stores the all of the information in memory. On exist it dump a JSON
file that can be reused on launch. The data is limited, and holds only the most
recent data.

Cosmad uses DuckDB, all of the block data and alerts are stored in a database.
DuckDB has a limit of having one read-write client connection per db file.
To avoid this limit, there is a Unix Socket for communication with the database.
So the data processor and API can communicate with the database without being
limited by client connections. API provides all of the endpoints the dashboard
uses so if you do not plan to use the dashboard, you can roll your own using
the API.

The _con_ this raises complexity if you want to adjust this script, it requires
you implement query methods, add it to the proper interface, apply it to the engine
clients and pass it to the API (depending on what you are trying to do). For anyone
that just plans to run as it is should not cause any issues, only for the developers
that want to fork and modify the script.

Another thing to consider is the maintenance of the database, while it holds all
of the data, it can grow quite large over time.

#### Access to the state

Cosmad provides both a REST API and a Unix Socket for accessing the state.
The REST API is used by the dashboard, while the Unix Socket is used by the data
processor and API.

While the unix socket requires handshake, and divides connections by role. The
recommended way to collect data and interact with the the state is through the API.

For any write operations, then Unix Socket will be needed. It is not recommended
to manually interact with it unless you really need to.

## Roadmap

This is a work in progress and the roadmap is subject to change.

- Add alert options:
  - [x] PagerDuty
  - [x] Telegram
  - [ ] Slack
  - [x] Discord
  - [x] Healthchecks
- [x] Record blocks and alerts and keep them in the database
- [ ] Pruning database option
- [ ] Store other validator data (e.g. delegator count, staked amount etc...)
- Dashboard:
  - [ ] Live tracking of the chain state
  - [ ] Statistics for the last X days
  - [ ] Per chain stats
