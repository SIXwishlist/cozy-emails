// Generated by CoffeeScript 1.10.0
var AccountConfigError, BadRequest, MailboxRefresh, Message, MessageMove, NotFound, Process, Scheduler, _, async, log, normalizeMessageID, ramStore, ref, uuid,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

Process = require('./_base');

async = require('async');

Message = require('../models/message');

log = require('../utils/logging')({
  prefix: 'process:message_saving'
});

ref = require('../utils/errors'), NotFound = ref.NotFound, BadRequest = ref.BadRequest, AccountConfigError = ref.AccountConfigError;

normalizeMessageID = require('../utils/jwz_tools').normalizeMessageID;

MailboxRefresh = require('../processes/mailbox_refresh');

Scheduler = require('../processes/_scheduler');

uuid = require('uuid');

ramStore = require('../models/store_account_and_boxes');

_ = require('lodash');

module.exports = MessageMove = (function(superClass) {
  extend(MessageMove, superClass);

  function MessageMove() {
    this.fetchNewUIDs = bind(this.fetchNewUIDs, this);
    this.applyOneChangeInCozy = bind(this.applyOneChangeInCozy, this);
    this.applyChangesInCozy = bind(this.applyChangesInCozy, this);
    this.handleMoveOneBox = bind(this.handleMoveOneBox, this);
    this._messageInAllDestinations = bind(this._messageInAllDestinations, this);
    this.moveImap = bind(this.moveImap, this);
    return MessageMove.__super__.constructor.apply(this, arguments);
  }

  MessageMove.prototype.initialize = function(options, callback) {
    var ignores;
    this.to = Array.isArray(options.to) ? options.to : [options.to];
    this.from = options.from || null;
    this.messages = options.messages.filter((function(_this) {
      return function(msg) {
        var boxes;
        boxes = Object.keys(msg.mailboxIDs);
        return _.xor(boxes, _this.to).length > 1;
      };
    })(this));
    this.alreadyMoved = [];
    this.changes = {};
    ignores = null;
    this.fromBox = ramStore.getMailbox(this.from);
    this.destBoxes = this.to.map(function(id) {
      return ramStore.getMailbox(id);
    });
    this.ignores = ramStore.getIgnoredMailboxes();
    this.destString = this.to.join(',');
    log.debug("batchMove", this.messages.length, this.from, this.to);
    return async.series([this.moveImap, this.applyChangesInCozy, this.fetchNewUIDs], (function(_this) {
      return function(err) {
        return callback(err, _this.updatedMessages);
      };
    })(this));
  };

  MessageMove.prototype.moveImap = function(callback) {
    return Message.doGroupedByBox(this.messages, this.handleMoveOneBox, callback);
  };

  MessageMove.prototype._messageInAllDestinations = function(message) {
    var box, i, len, ref1;
    ref1 = this.to;
    for (i = 0, len = ref1.length; i < len; i++) {
      box = ref1[i];
      if (message.mailboxIDs[box] == null) {
        return false;
      }
    }
    return true;
  };

  MessageMove.prototype.handleMoveOneBox = function(imap, state, nextBox) {
    var base, base1, base2, currentBox, destBox, expunges, i, id, j, len, len1, message, moves, mustRemove, paths, ref1, ref2, uid;
    currentBox = state.box;
    if (indexOf.call(this.destBoxes, void 0) >= 0) {
      return nextBox(new Error("One of destination boxes " + this.destString + " doesnt exist"));
    }
    if (indexOf.call(this.destBoxes, currentBox) >= 0) {
      return nextBox(null);
    }
    mustRemove = currentBox === this.fromBox || !this.from;
    moves = [];
    expunges = [];
    ref1 = state.messagesInBox;
    for (i = 0, len = ref1.length; i < len; i++) {
      message = ref1[i];
      id = message.id;
      uid = message.mailboxIDs[currentBox.id];
      if (this._messageInAllDestinations(message) || indexOf.call(this.alreadyMoved, id) >= 0) {
        if (mustRemove) {
          expunges.push(uid);
          if ((base = this.changes)[id] == null) {
            base[id] = message.cloneMailboxIDs();
          }
          delete this.changes[id][currentBox.id];
        }
      } else if (message.isDraft() && this.from === null) {
        expunges.push(uid);
        if ((base1 = this.changes)[id] == null) {
          base1[id] = message.cloneMailboxIDs();
        }
        delete this.changes[id][currentBox.id];
      } else {
        moves.push(uid);
        this.alreadyMoved.push(id);
        if ((base2 = this.changes)[id] == null) {
          base2[id] = message.cloneMailboxIDs();
        }
        delete this.changes[id][currentBox.id];
        ref2 = this.destBoxes;
        for (j = 0, len1 = ref2.length; j < len1; j++) {
          destBox = ref2[j];
          this.changes[id][destBox.id] = -1;
        }
      }
    }
    log.debug("MOVING", moves, "FROM", currentBox.id, "TO", this.destString);
    log.debug("EXPUNGING", expunges, "FROM", currentBox.id);
    paths = this.destBoxes.map(function(box) {
      return box.path;
    });
    return imap.multimove(moves, paths, function(err, result) {
      if (err) {
        return nextBox(err);
      }
      return imap.multiexpunge(expunges, function(err) {
        if (err) {
          return nextBox(err);
        }
        return nextBox(null);
      });
    });
  };

  MessageMove.prototype.applyChangesInCozy = function(callback) {
    return async.mapSeries(this.messages, (function(_this) {
      return function(message, next) {
        var newMailboxIDs;
        newMailboxIDs = _this.changes[message.id];
        return _this.applyOneChangeInCozy(message, newMailboxIDs, next);
      };
    })(this), (function(_this) {
      return function(err, result) {
        if (err) {
          return callback(err);
        }
        _this.updatedMessages = result;
        return callback(null);
      };
    })(this));
  };

  MessageMove.prototype.applyOneChangeInCozy = function(message, newMailboxIDs, callback) {
    var boxes, data;
    if (!newMailboxIDs) {
      return callback(null, message);
    } else {
      boxes = Object.keys(newMailboxIDs);
      if (boxes.length === 0) {
        return message.destroy(function(err) {
          return callback(err, {
            id: message.id,
            _deleted: true
          });
        });
      } else {
        data = {
          mailboxIDs: newMailboxIDs,
          ignoreInCount: boxes.some((function(_this) {
            return function(id) {
              return _this.ignores[id];
            };
          })(this))
        };
        return message.updateAttributes(data, function(err) {
          return callback(err, message);
        });
      }
    }
  };

  MessageMove.prototype.fetchNewUIDs = function(callback) {
    var limitByBox, refreshes;
    if (this.updatedMessages.length === 0) {
      return callback(null, []);
    }
    if (this.destBoxes == null) {
      return callback(null, []);
    }
    limitByBox = Math.max(100, this.messages.length * 2);
    refreshes = this.destBoxes.map(function(mailbox) {
      return new MailboxRefresh({
        mailbox: mailbox,
        limitByBox: limitByBox
      });
    });
    return Scheduler.scheduleMultiple(refreshes, (function(_this) {
      return function(err) {
        return callback(err, _this.updatedMessages);
      };
    })(this));
  };

  return MessageMove;

})(Process);