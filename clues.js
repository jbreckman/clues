(function(self) {
  if (typeof module !== 'undefined') {
    clues.Promise = require('bluebird');
    module.exports = clues;
  } else {
    clues.Promise = self.Promise;
    self.clues = clues;
  }

  var reArgs = /^\s*function.*?\(([^)]*?)\).*/;
  var reEs6 =  /^\s*\({0,1}(.*?)\){0,1}\s*=>/;
  var reEs6Class = /^\s*[a-zA-Z0-9\-\$\_]+\((.*?)\)\s*{/;
  var argCache = {}, stringIntern = {};

  function matchArgs(fn) {
    if (!fn.__args__) {
      var originalMatch = fn.prototype && fn.prototype.constructor.toString() || fn.toString();
      var argCacheHit = argCache[originalMatch];
      if (argCacheHit) {
        fn.__args__ = argCacheHit;
        return argCacheHit;
      }

      match = originalMatch.replace(/^\s*async/,'');
      match = reArgs.exec(match) || reEs6.exec(match) || reEs6Class.exec(match);
      fn.__args__ = match[1].replace(/\s/g,'')
        .split(',')
        .filter(function(d) {
          return d.length;
        })
        .map(s => internString(s));

      argCache[originalMatch] = fn.__args__;
    }
    return fn.__args__;
  }

  function internString(s) {
    if (!s.__cluesinterned) {
      var internedResults = stringIntern[s];
      if (!internedResults) {
        let removeChars = 0, original = s;
        s = new String(s);
        s.__cluesinterned = true;
        s.__dot = s.search(/ᐅ|\./);
        if (s[0] === '_') {
          s.__optional = true;
          removeChars++;
        }
        if (s[1] === '_') {
          s.__showError = true;
          removeChars++;
        }
        if (removeChars) {
          s.__base = original.slice(removeChars);
          s.__baseInterned = internString(s.__base);
        }
        else {
          s.__base = original;
        }
        stringIntern[original] = s;
      }
      else {
        return internedResults;
      }
    }
    return s;
  }

  function clues(logic,fn,$global,caller,fullref) {
    var args,ref;

    if (!$global) $global = {};
    if (caller) caller = caller.toString();

    if (typeof logic === 'function' || (logic && typeof logic.then === 'function'))
      return clues({},logic,$global,caller,fullref)
        .then(function(logic) {
          return clues(logic,fn,$global,caller,fullref);
        });
      
    if (typeof fn === 'string' || fn instanceof String) {
      ref = internString(fn);
      
      var dot = ref.__dot;
      if (dot > -1 && (!logic || logic[ref] === undefined)) {
        var next = ref.__next || (ref.__next = internString(ref.slice(0,dot)));
        return clues(logic,next,$global,caller,fullref)
          .then(function(d) {
            logic = d;
            ref = ref.__ref || (ref.__ref = internString(ref.slice(dot+1)));
            fullref = (fullref ? fullref+'.' : '')+next;
            return clues(logic,ref,$global,caller,fullref);
          })
          .catch(function(e) {
            if (e && e.notDefined && logic && logic.$external && typeof logic.$external === 'function')
              return logic[ref] = logic[ref] || clues(logic,function() { return logic.$external.call(logic,ref); },$global,ref,(fullref ? fullref+'.' : '')+ref);
            else throw e;
          });
      }

      fullref = (fullref ? fullref+'.' : '')+ref;
      fn = logic ? logic[ref] : undefined;
      if (fn === undefined) {
        if (typeof(logic) === 'object' && logic !== null && (Object.getPrototypeOf(logic) || {})[ref] !== undefined)
          fn = Object.getPrototypeOf(logic)[ref];
        else if ($global[ref] && caller && caller !== '__user__')
          return clues($global,ref,$global,caller,fullref);
        else if (logic && logic.$property && typeof logic.$property === 'function')
          fn = logic[ref] = function() { return logic.$property.call(logic,ref); };
        else return clues.Promise.reject({ref : ref.toString(), message: ref+' not defined', fullref:fullref,caller: caller, notDefined:true});
      }
    }

    // Support an array with some argument names in front and the function as last element
    if (Array.isArray(fn) && typeof fn[fn.length-1] == 'function') {
      if (fn.length > 1 && (typeof(fn[0]) === 'object' || typeof(fn[0]) == 'function') && !fn[0].length) {
        var obj = fn[0];
        fn = fn.slice(1);
        if (fn.length === 1) fn = fn[0];
        var result = clues(obj,fn,$global,caller,fullref);
        if (ref) {
          logic[ref] = result;
        }
        return result;
      }
      args = fn.slice(0,fn.length-1);
      fn = fn[fn.length-1];
      var fnArgs = matchArgs(fn);
      var numExtraArgs = fnArgs.length-args.length;
      if (numExtraArgs) {
        args = args.concat(fnArgs.slice(numExtraArgs));
      }
    }

    // If fn name is private or promise private is true, reject when called directly
    if (fn && (!caller || caller == '__user__') && ((typeof(fn) === 'function' && (fn.name == '$private' || fn.name == 'private')) || (fn.then && fn.private)))
     return clues.Promise.reject({ref : ref.toString(), message: ref+' not defined', fullref:fullref,caller: caller, notDefined:true});

    // If the logic reference is not a function, we simply return the value
    if (typeof fn !== 'function' || (ref && ref[0] === '$')) {
      // If the value is a promise we wait for it to resolve to inspect the result
      if (fn && typeof fn.then === 'function')
        return fn.then(function(d) {
          // Pass results through clues again if its a function or an array (could be array function)
          return (typeof d == 'function' || (d && typeof d == 'object' && d.length)) ? clues(logic,d,$global,caller,fullref) : d;
        });
      else 
        return clues.Promise.resolve(fn);
    }

    args = (args || matchArgs(fn));

    // Shortcuts to define empty objects with $property or $external
    if (fn.name === '$property' || (args.length === 1 && args[0] && args[0].__base === '$property')) return logic[ref] = clues.Promise.resolve({$property: fn.bind(logic)});
    if (fn.name === '$external' || (args.length === 1 && args[0] && args[0].__base === '$external')) return logic[ref] = clues.Promise.resolve({$external: fn.bind(logic)});
    
    args = args.map(function(arg) {
        var res, optional = false, showError = false;


        if (arg instanceof String || typeof arg === 'string') {
          arg = internString(arg);

          let direct = logic[arg];
          if (direct && typeof direct !== 'function' && !Array.isArray(direct)) {
            return direct;
          }

          optional = arg.__optional;
          showError = arg.__showError;
          var base = arg.__base;

          if (base[0] === '$' && logic[base] === undefined) {
            if (base === '$caller')
              res = clues.Promise.resolve(caller);
            else if (base === '$fullref')
              res = clues.Promise.resolve(fullref);
            else if (base === '$global')
              res = clues.Promise.resolve($global);
          }
        }

        return res || clues(logic,arg.__baseInterned || arg,$global,ref || 'fn',fullref)
          .then(null,function(e) {
            if (optional) return (showError) ? e : undefined;
            else throw e;
          });
      });

    var inputs =  clues.Promise.all(args),
        wait = Date.now(),
        duration;

    var value = inputs
      .then(function(args) {
        duration = Date.now();
        return clues.Promise.try(function() {
          return fn.apply(logic || {}, args);
        })
        .catch(function(e) {
          if (e && e.stack && typeof $global.$logError === 'function')
            $global.$logError(e, fullref);
          throw e;
        });
      })
      .finally(function() {
        if (typeof $global.$duration === 'function')
          $global.$duration(fullref || ref || (fn && fn.name),[(Date.now()-duration),(Date.now())-wait],ref);
      })
      .then(function(d) {
        return (typeof d == 'string' || d instanceof String || typeof d == 'number') ? d : clues(logic,d,$global,caller,fullref);
      })
      .catch(function(e) {
        if (typeof e !== 'object')
          e = { message : e};
        e.error = true;
        e.ref = e.ref || (ref && ref.toString());
        e.fullref = e.fullref || fullref;
        e.caller = e.caller || caller || '';
        if (fn && fn.name == '$noThrow')
          return e;
        throw e;
      });

    if (fn.name == 'private' || fn.name == '$private')
      value.private = true;

    value.name = fn.name;
    value.fn = fn;

    if (ref) {
      logic[ref] = value;
      if (logic[ref] !== value)
        return clues.Promise.try(function() {
          Object.defineProperty(logic,ref,{value: value, enumerable: true, configurable: true});
          return value;
        })
        .catch(function(e) {
          return value.then(function(value) {
            return clues.Promise.reject({ref : ref.toString(), message: 'Object immutable', fullref:fullref,caller: caller, stack:e.stack, value: value});
          });
        });
    }

    return value;
    
  }

})(this);