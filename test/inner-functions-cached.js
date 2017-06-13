
const clues = require('../clues');
const Promise = require('bluebird');
const t = require('tap');

function shouldError(e) { throw 'Should error '+e;}

var Logic = {
  a : 41,
  b: 1,
  d: 1, e:1,f:1,
  g:1,h:1,i:1,j:1,k:1,l:1,
  c : a => {
    return function(b,d,e,f,g,h,i,j,k,l) {
      return a+b;
    };
  }
};

t.test('inner functions cached', {autoend: true}, t => {
  var counter = 0;
  function a() {
    return clues(Object.create(Logic),'c')
      .then(function(d) {
        if (counter++ < 500000) {
          return a();
        }
        else {
          t.same(d,'42');
        }
      });
  }
  a();
});