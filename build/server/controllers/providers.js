// Generated by CoffeeScript 1.9.1
var DOMParser, https;

https = require('https');

DOMParser = require('xmldom').DOMParser;

module.exports.get = function(req, res, next) {
  var url;
  url = "https://autoconfig.thunderbird.net/v1.1/" + req.params.domain;
  req = https.get(url, function(response) {
    var body;
    if (response.statusCode !== 200) {
      return res.send(response.statusCode, '');
    } else {
      body = '';
      response.on('data', function(data) {
        return body += data;
      });
      return response.on('end', function() {
        var doc, getServers, getValue, i, infos, len, parseServer, provider, providers, results;
        doc = new DOMParser().parseFromString(body);
        providers = doc.getElementsByTagName('emailProvider');
        infos = [];
        getValue = function(node, tag) {
          var nodes;
          nodes = node.getElementsByTagName(tag);
          if (nodes.length > 0) {
            return nodes[0].childNodes[0].nodeValue;
          }
        };
        parseServer = function(node) {
          var server;
          server = {
            type: node.getAttribute('type'),
            hostname: getValue(node, 'hostname'),
            port: getValue(node, 'port'),
            socketType: getValue(node, 'socketType')
          };
          return infos.push(server);
        };
        getServers = function(provider) {
          var i, j, len, len1, server, servers;
          servers = provider.getElementsByTagName('incomingServer');
          for (i = 0, len = servers.length; i < len; i++) {
            server = servers[i];
            parseServer(server);
          }
          servers = provider.getElementsByTagName('outgoingServer');
          for (j = 0, len1 = servers.length; j < len1; j++) {
            server = servers[j];
            parseServer(server);
          }
          return res.send(infos);
        };
        results = [];
        for (i = 0, len = providers.length; i < len; i++) {
          provider = providers[i];
          results.push(getServers(provider));
        }
        return results;
      });
    }
  });
  return req.on('error', function(e) {
    return res.status(500).send({
      error: "Error getting provider infos : " + e.message
    });
  });
};
