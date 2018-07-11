'use strict';

import Fabric from '../';

const Swarm = require('../lib/swarm');

async function main () {
  const cli = new Fabric.CLI({
    oracle: {
      path: `./data/${process.env['NAME'] || 'cli'}`,
      port: process.env['PORT'] || 3007
    }
  });
  const swarm = new Swarm({
    peer: {
      port: process.env['PEER_PORT'] || 7777
    },
    peers: [
      'fabric.pub:7777',
      // 'localhost:7450', // for `examples/network.js`
      // 'localhost:7777'
    ]
  });

  // TODO: move to lib/chat.js
  cli.oracle.define('Message', {
    routes: {
      list: '/messages',
      get: '/messages/:id'
    }
  });

  // TODO: move into Fabric proper (Oracle?)
  cli.oracle.define('Peer', {
    routes: {
      list: '/peers',
      get: '/peers/:id'
    }
  });

  try {
    await cli.start();
  } catch (E) {
    console.error('[CLI]', 'main()', E);
  }

  swarm.on('changes', async function (changes) {
    cli.oracle.machine.applyChanges(changes);
    await cli.oracle._sync();
  });

  swarm.start();

  cli.oracle.on('changes', function (changes) {
    console.log('MAIN', 'received changes:', changes);
    swarm.self.broadcast(changes);
  });

  cli.oracle.on('/messages', function (msg) {
    // TODO: standardize an API for addressable messages in Oracle/HTTP
    // console.log('MAIN', 'received message:', msg);
  });
}

main();
