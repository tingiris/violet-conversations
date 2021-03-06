/* Copyright (c) 2017-present, salesforce.com, inc. All rights reserved */
/* Licensed under BSD 3-Clause - see LICENSE.txt or git.io/sfdc-license */

const path = require('path');
const express = require('express');
const zip = require('express-easy-zip');
const bodyParser = require('body-parser');
// const DialogflowApp = require('actions-on-google').DialogflowApp;
const dialogflowClient = require('dialogflow-fulfillment').WebhookClient;
const PlatformReq = require('./platformPlugin.js').PlatformReq;
const PlatformPlugin = require('./platformPlugin.js').PlatformPlugin;


// v1 sdk documentation: https://developers.google.com/actions/reference/nodejs/DialogflowApp
// v2 sdk documentation: https://github.com/dialogflow/dialogflow-fulfillment-nodejs/blob/master/docs/WebhookClient.md
// TODO: expose goals as context

const violetToPlatformTypeMap = {
  'number': '@sys.number',
  'firstName': '@sys.given-name',
  'date': '@sys.date',
  'time': '@sys.time',
  'phoneNumber': '@sys.phone-number',
  'phrase': '@sys.any'
};

function guessSamples(violetType) {
  switch (violetType) {
    case 'number':
      return Math.floor(Math.random() * 100);
    default:
      console.log(`ERR - googlePlatform: ${violetType} not supported`)
      return 'UNKNOWN TYPE'
  }
}


function addFile(zipFiles, name, jsonBody) {
  zipFiles.push({
    name: name,
    content: JSON.stringify(jsonBody, null, 2)
  })
}
function genConfigMeta(zipFiles, req) {
  addFile(zipFiles, `package.json`, {"version": "1.0.0"});
  // spec: https://dialogflow.com/docs/reference/agent-json-fields
  var svcUrl = req.protocol + '://' + req.headers.host + req.originalUrl
  svcUrl = svcUrl.replace('/config','')

  addFile(zipFiles, `agent.json`, {
      // "description": "",
      webhook: {
        url: req.protocol + '://' + req.get('Host') + req.url,
        available: true
      },
      language: "en"
    });
};
function genConfigIntents(zipFiles, googlePlatform) {
  Object.keys(googlePlatform.intentParams).forEach((intentName)=>{
    // spec: https://dialogflow.com/docs/reference/agent/intents
    var intentInfo = {
      name: intentName,
      auto: true, // <-- ml enabled
      webhookUsed: true
    };
    var slots = googlePlatform.intentParams[intentName].slots;
    if (slots) {
      intentInfo.responses = [{
        parameters: []
      }];
      Object.keys(slots).forEach((slotName)=>{
        intentInfo.responses[0].parameters.push({
            isList: false,
            name: slotName,
            value: "$" + slotName,
            dataType: violetToPlatformTypeMap[slots[slotName]]
        });
      });
    }
    addFile(zipFiles, `intents${path.sep}${intentName}.json`, intentInfo)

    var gUtterances = [];
    googlePlatform.intentParams[intentName].utterances.forEach((utterance)=>{
      var gUtteranceInfo = {
        data: [],
        isTemplate: false,
        count: 0,
      };
      utterance.split(/[{}]/).forEach((u,ndx)=>{
        if (u.length == 0) return;
        var fVar = (ndx%2 == 0) ? false : true;
        var guData = {userDefined: false}
        if (fVar) {
          var nameMarker = u.indexOf('|');

          // set: alias
          if (nameMarker == -1)
            guData.alias = u;
          else
            guData.alias = u.substr(nameMarker+1);

          // set: meta
          guData.meta = violetToPlatformTypeMap[slots[guData.alias]]

          // set: text
          if (u.startsWith('-|')) {
            guData.text = guessSamples(slots[guData.alias]);
          } else {
            guData.text = u.substring(0, nameMarker);
          }
        } else {
          guData.text = u;
        }
        gUtteranceInfo.data.push(guData);
      });
      gUtterances.push(gUtteranceInfo);
    });

    addFile(zipFiles, `intents${path.sep}${intentName}_usersays_en.json`, gUtterances)
  });
}

class GooglePlatformReq extends PlatformReq {

  constructor(platform, request, response) {
    super(platform, request, response);

    this.shouldEndSession = true;

    this.sessionStore = {};
    var sessionContext = this.platform.app.getContext('session');
    if (sessionContext) sessionStore = sessionContext.parameters;
    Object.keys(this.platform.app.parameters).forEach(pName=>{
      sessionStore[pName] = this.platform.app.parameters[pName];
    });
  }

  getUserId() {
    // TODO: is this correct, i.e. for Google (it works for Alexa)
    return this.request.userId;
  }

  getSlots() {
    return Object.keys(this.platform.app.parameters);
  }

  getSlot(slotName) {
    return this.platform.app.parameters[slotName];
  }

  getSession() {
    return {
      getAttributes: () => {
        return this.sessionStore;
      },
      get: (varStr) => {
        return this.sessionStore[varStr];
      },
      set: (varStr, val) => {
        this.sessionStore[varStr] = val;
      }
    };
  }

  say(str) {
    if (shouldEndSession)
      platform._tell(str);
    else
      platform._ask(str);
  }

  shouldEndSession(flag) {
    this.shouldEndSession = flag;
  }
}

class GooglePlatform extends PlatformPlugin {

  _tell(str) {
    this.app.add(str);
  }

  _ask(str) {
    let conv = this.app.conv();
    conv.ask(str);
    this.app.add(conv);
  }

  constructor(endpoint) {
    super(endpoint);
    this.intentHandlers = {};
    this.intentParams = {};
    this.customSlots = {};
    this.intentHandlers = {
      'input.welcome': () => {
        this._tell('Hello, Welcome to my Dialogflow agent!');
      },
      'default': () => {
        this._tell('The default handler for unknown or undefined actions got triggered!');
      }
    };
  }

  setServerApp(violetRouter) {
    const platform = this;
    violetRouter.use(zip())

    violetRouter.use(bodyParser.json({ type: 'application/json' }));
    // violetRouter.get('/', function (request, response) {
    //   response.send('Go to /config for generating Dialogflow import data');
    // });
    violetRouter.get('/googleConfig', function (request, response) {
      var zipFiles = [];
      genConfigMeta(zipFiles, request);
      genConfigIntents(zipFiles, platform);
      response.zip({
        filename: platform.appName + '.zip',
        files: zipFiles
      });
    });
    violetRouter.post('/' + this.endpoint, function (request, response) {
      try {
        // console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
        console.log('Dialogflow Request body: ' + JSON.stringify(request.body));

        platform.app = new dialogflowClient({request: request, response: response});
        console.log(platform.app.parameters)
        let intentName = platform.app.intent;
        if (!platform.intentHandlers[intentName]) {
          intentName = 'default';
        }
        console.log(`Received request for: ${intentName}`)
        let result = platform.intentHandlers[intentName](new GooglePlatformReq(platform, request, response));
        Promise.resolve(result).then(()=>{
          platform.app.setContext({name: 'session', lifespan: 100, parameters: sessionStore});
          platform.app.send_();
        })
      } catch (e) {
        console.log('Caught Error: ', e);
        response.end();
      }
    });
  }

  onError(cb) {
    this.errorCB = cb;
  }

  onLaunch(cb) {
    this.launchCB = cb;
  }

  regIntent(name, params, cb) {
    console.log('registering: ', name, params);
    this.intentHandlers[name] = cb;
    this.intentParams[name] = params;
  }

  regCustomSlot(type, values) {
    this.customSlots[type] = values;
  }

}

module.exports = GooglePlatform;
