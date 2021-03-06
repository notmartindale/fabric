'use strict';

import Fabric from '../';

const fs = require('fs');
const util = require('util');
const ssri = require('ssri');
const jade = require('jade');
const express = require('express');
const bodyParser = require('body-parser');
const pattern = require('path-match')();

const App = require('./app');
const Oracle = require('./oracle');
const Resource = require('./resource');

class HTTP extends Oracle {
  /**
   * Builds an HTTP server for a Contract.  Useful for servicing the legacy web.
   * @param  {Object} config General configuration object for the server.
   * @param  {Object} config.secure Disable security.  Defaults to true fn (!).
   * @param  {Object} config.bootstrap Load Assets from `./assets`.
   * @return {HTTP}        Instance of the resulting Authority.
   */
  constructor (config) {
    if (!config) config = {};

    config = {
      precompile: config.precompile || true,
      port: config.port || 3000
    };

    super(config);

    this.app = new App();
    this.config = config;

    this.http = express();

    this.resources = {};
    this.routes = {};

    if (config.client && config.client.precompile) {
      this.http.set('view engine', 'js');
      this.http.engine('js', require('compiled-jade-render'));
    } else {
      this.http.set('view engine', 'jade');
    }

    this.http.set('views', 'assets');

    this.http.use(bodyParser.json());
    this.http.use(function(req, res, next) {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
      return next();
    });

    return this;
  }

  async start () {
    await super.start();

    if (this.config.bootstrap === true) {
      try {
        let assets = await this._load('./assets', {});
        console.debug('initial assets:', assets);
      } catch (E) {
        console.error('[HTTP]', 'failed bootstrap:', E);
      }
    }

    let Asset = await this.define('Asset', require('../resources/asset'));
    let Index = this.routes['/'] = 'Index';

    try {
      this.server = await this.http.listen(3000);
      console.log('[HTTP]', 'listening', this.server.address());
    } catch (E) {
      console.error('[HTTP]', E);
    }

    return this;
  }

  async stop () {
    await super.stop();

    try {
      await this.server.close();
      await this.app.tips.close();
      await this.app.stash.close();
      await this.storage.close();

      for (var name in this.resources) {
        let resource = this.resources[name];
        if (resource.store) {
          await resource.store.close();
        }
      }
    } catch (E) {
      console.error('[HTTP]', E);
    }

    return this;
  }

  /**
   * Creates associations in memory by defining a resource by its `name`.
   * @param  {String}  name       Human-friendly name of this {@link Resource}.
   * @param  {Object}  definition Resource description object.
   * @return {Promise}            [description]
   */
  async define (name, definition) {
    //let real = await super.define(name, definition);
    let self = this;

    console.debug('[HTTP]', 'defining...', name, definition);

    try {
      let app = await this.app.define(name, definition);
      let resource = app.resources[name];

      let source = definition.routes.query + '/:id';
      let query = definition.routes.query;

      self.routes[source] = name;
      self.routes[query] = name;

      self.resources[name] = resource;

      this.http.put('/*', self.router.bind(self));
      this.http.get('/*', self.router.bind(self));
      this.http.post('/*', self.router.bind(self));
      this.http.patch('/*', self.router.bind(self));
      this.http.delete('/*', self.router.bind(self));
      this.http.options('/*', self.router.bind(self));

      self.keys.push(query);

    } catch (E) {
      console.error('[HTTP]', 'defining:', name, E);
    }

    return this;
  }
  
  async _OPTIONS (link) {
    let options = new Fabric.Vector(this.resources)._sign();
    return options['@data'];
  }

  async route (link) {
    console.debug('[HTTP]', '[ROUTER]', link, this.routes);
    
    for (var route in this.routes) {
      let name = this.routes[route];
      let valid = pattern(route);
      let match = valid(link);

      if (match) {
        return {
          resource: name,
          method: (match && match.id) ? 'get' : 'list',
          query: match
        };
      }
    }
  }

  async router (request, response, skip) {
    let route = await this.route(request.path);

    console.debug('[HTTP]', '[ROUTER]','route:', request.path, route);

    if (!route) {
      return response.send({
        status: 'error',
        message: `Received "${request.method} ${request.path}", which is not yet implemented.  Use OPTIONS for a list of available methods.`
      });
    }

    let resource = this.resources[route.resource];

    switch (request.method) {
      default:
        response.send({
          status: 'warning',
          message: `Received "${request.method} ${request.path}" for ${resource.name}, which is not yet implemented.  Use OPTIONS for a list of available methods.`
        });
        break;
      case 'OPTIONS':
        try {
          let answer = await this._OPTIONS(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          response.send(vector);
        } catch (E) {
          console.error(E);
        }
        break;
      case 'GET':
        try {
          let answer = await this._GET(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          response.send(vector);
        } catch (E) {
          console.error(E);
        }
        break;
      case 'PUT':
        try {
          let answer = await this._PUT(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          let result = await this._GET(request.path);
          let output = new Fabric.Vector(result)._sign();

          response.send(output);
        } catch (E) {
          console.error(E);
        }
        break;
      case 'POST':
        try {
          console.debug('raw body:', request.body);

          let answer = await this._POST(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          let result = await this._GET(request.path);
          let output = new Fabric.Vector(result)._sign();

          response.send(vector['@data']);
        } catch (E) {
          console.error(E);
        }
        break;
      case 'PATCH':
        try {
          let answer = await this._PATCH(request.path, request.body);
          let vector = new Fabric.Vector(answer)._sign();

          console.debug('answer:', answer);
          console.debug('vector:', vector);

          let result = await this._GET(request.path);
          let output = new Fabric.Vector(result)._sign();

          response.send(output);
        } catch (E) {
          console.error(E);
        }
        break;
      case 'DELETE':
        try {
          let answer = await this._DELETE(request.path);
          let vector = new Fabric.Vector(answer)._sign();

          response.send(vector);
        } catch (E) {
          console.error(E);
        }
        break;
    }

    return this;
  }

  async render (path) {
    return this['@data'];
  }
}

module.exports = HTTP;
