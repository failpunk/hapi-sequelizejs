/**
 * hapi-sequelizejs
 *
 * hapi.js plugin for the Sequelize ORM
 *
 * ## config
 *  [{
 *    name: 'dbname',
 *    models: ['path/one/*.js', 'path/two/*.js'],
 *    sequelize: new Sequelize(options),
 *    sync: true,
 *    forceSync: false,
 *    debug: true,
 *    onConnect: function (database) { ... }
 *  }]
 *
 * @exports register
 */

'use strict';

const Joi = require('joi');
const Schema = require('./schema');
const Models = require('./models');
const DB = require('./DB');
const Pkg = require('../package.json');

// Module globals
const internals = {};

internals.configure = function (opts) {
    return opts.sequelize.authenticate().then(() => {

        if (opts.models) {

            return Models.getFiles(opts.models).then((files) => {
                return Models.load(files, opts.sequelize.import.bind(opts.sequelize))
                    .then((models) => Models.applyRelations(models))
                    .then((models) => {

                        if (opts.sync) {
                            return opts.sequelize.sync({
                                force: opts.forceSync
                            }).then(() => Promise.resolve(new DB(opts.sequelize, models)));
                        } else {
                            return Promise.resolve(new DB(opts.sequelize, models));
                        }
                    });
            });

        } else {
            return Promise.resolve(new DB(opts.sequelize, []));
        }
    }, (err) => {
        return Promise.reject(
            new Error(`An error occurred while attempting to connect to DB [${opts.name}], please check the configuration. Details: ` + err.message)
        );
    }).then((database) => {
        if (opts.onConnect) {
            let onConnect = opts.onConnect(database);
            // if is a promise, wait until it finishes
            if (onConnect && typeof onConnect.then === 'function') {
                return onConnect.then(() => database);
            }
        }

        return database;
    });
};

exports.plugin = {
    pkg: Pkg,

    register: (server, options) => {
        if (!options) return Promise.reject('Missing hapi-sequelizejs plugin options');
        if (!Array.isArray(options)) options = [options];

        const validation = Joi.validate(options, Schema.options);
        if (!validation || validation.error) return Promise.reject(validation.error);

        const getDb = (request) => {
            return function getDb(name) {
                if (!name) {
                    const key = Object.keys(request.server.plugins[Pkg.name]).shift();
                    return request.server.plugins[Pkg.name][key];
                } else if (!request.server.plugins[Pkg.name].hasOwnProperty(name)) {
                    throw new Error(
                        `hapi-sequelizejs cannot find the ${name} database instance`
                    );
                }

                return request.server.plugins[Pkg.name][name];
            };
        };

        server.decorate('request', 'getDb', getDb, {
            apply: true
        });

        const configured = options.reduce((acc, opts) => {
            return [].concat(acc, [
                internals.configure(opts)
                    .then((db) => {
                        server.expose(opts.name, db);
                        return Promise.resolve(db);
                    }, (err) => {
                        return Promise.reject(err);
                    })
            ]);
        }, []);

        return Promise.all(configured)
    },
}
