/*
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2013 Andrey Popp <8mayday@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
'use strict';

var through     = require('through'),
    escope      = require('escope'),
    esprima     = require('esprima'),
    escodegen   = require('escodegen'),
    common      = require('esmangle/lib/common'),
    evaluator   = require('./evaluator'),
    convert     = require('convert-source-map'),
    Syntax      = common.Syntax;

function handleIfStatement(node, scope, knownVars) {
  var body = [],
      test = evaluator.booleanCondition(node.test, knownVars),
      instrumentedScope = {
        resolve: function(node) {
          if (knownVars[node.name] !== undefined) {
            return {isStatic: function() { return true; }};
          } else {
            return scope.resolve(node);
          }
        }
      },
      sideEffect = evaluator.hasSideEffect(node.test, instrumentedScope);

  if (!node.alternate) {
    if (typeof test === 'boolean') {
      if (test) {
        if (sideEffect)
          body.push(common.moveLocation(node.test, {
            type: Syntax.ExpressionStatement,
            expression: substituteKnownVarsTransform(node.test, knownVars)
          }));
        body.push(node.consequent);
        return {
          type: Syntax.BlockStatement,
          body: body
        };
      } else {
        body.push(common.moveLocation(node.test, {
          type: Syntax.ExpressionStatement,
          expression: substituteKnownVarsTransform(node.test, knownVars)
        }));
        return {
          type: Syntax.BlockStatement,
          body: body
        };
      }
    }
  } else {
    if (typeof test === 'boolean') {
      if (test) {
        if (sideEffect)
          body.push(common.moveLocation(node.test, {
            type: Syntax.ExpressionStatement,
            expression: substituteKnownVarsTransform(node.test, knownVars)
          }));
        body.push(node.consequent);
        return {
          type: Syntax.BlockStatement,
          body: body
        };
      } else {
        if (sideEffect)
          body.push(common.moveLocation(node.test, {
            type: Syntax.ExpressionStatement,
            expression: substituteKnownVarsTransform(node.test, knownVars)
          }));
        body.push(node.alternate);
        return {
          type: Syntax.BlockStatement,
          body: body
        };
      }
    }
  }
}

function removeUnreachableBranchTransform(tree, knownVars) {
  var scope,
      manager = escope.analyze(tree, {directive: true});

  manager.attach();

  return common.replace(tree, {
    enter: function enter(node) {
      scope = manager.acquire(node) || scope;

      switch (node.type) {
        case Syntax.IfStatement:
          return handleIfStatement(node, scope, knownVars);
      }
    },
    leave: function leave(node) {
      scope = manager.release(node) || scope;
    }
  });
}

function substituteKnownVarsTransform(tree, knownVars) {
  if (!knownVars || Object.keys(knownVars).length === 0)
    return tree;
  return common.replace(tree, {
    enter: function(node) {
      if (node.type === Syntax.Identifier && knownVars[node.name] !== undefined) {
        return common.moveLocation(
          node,
          {type: Syntax.Literal, value: knownVars[node.name]});
      }
    }
  });
}

function flattenBlocksTransform(tree) {
  return common.replace(tree, {
    leave: function(node) {
      if (node.type === Syntax.BlockStatement || node.type === Syntax.Program) {
        var body = [];
        node.body.forEach(function(n) {
          if (n.type === Syntax.BlockStatement)
            body = body.concat(n.body)
          else
            body.push(n);
        });
        return common.moveLocation(node, {
          type: node.type,
          body: body
        });
      } else {
        return node;
      }
    }
  });
}

function removeUnreachableBranch(src, filename, knownVars) {
  var tree = esprima.parse(src, {loc: true});

  tree = removeUnreachableBranchTransform(tree, knownVars);
  tree = flattenBlocksTransform(tree);

  var result = escodegen.generate(tree, {
    sourceMap: filename,
    sourceMapWithCode: true
  });

  var map = convert.fromJSON(result.map);

  return result.code + '\n' + map.toComment();
}

function makeTransform(knownVars) {
  return function(filename) {
    var buf = [];
    return through(
      buf.push.bind(buf),
      function(end) {
        buf = buf.join('');
        var result = removeUnreachableBranch(buf, filename, knownVars);
        this.queue(result);
      });
  }
}

module.exports = makeTransform({__DEV__: false})
module.exports.makeTransform = makeTransform;
module.exports.removeUnreachableBranch = removeUnreachableBranch;
