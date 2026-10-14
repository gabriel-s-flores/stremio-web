"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.analytics = analytics;
exports.decode_stream = decode_stream;
exports["default"] = __wbg_init;
exports.dispatch = dispatch;
exports.encode_stream = encode_stream;
exports.get_state = get_state;
exports.initSync = initSync;
exports.initialize_runtime = initialize_runtime;
exports.start = start;
exports.webos_warm_up = webos_warm_up;
var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));
var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));
var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));
var importMeta = {
  url: new URL('/stremio_core_web.js', document.baseURI).href
};
/**
 * @param {any} event
 * @param {any} location_hash
 */
function analytics(event, location_hash) {
  wasm.analytics(addHeapObject(event), addHeapObject(location_hash));
}

/**
 * @param {any} stream
 * @returns {any}
 */
function decode_stream(stream) {
  var ret = wasm.decode_stream(addHeapObject(stream));
  return takeObject(ret);
}

/**
 * @param {any} action
 * @param {any} field
 * @param {any} location_hash
 */
function dispatch(action, field, location_hash) {
  try {
    var retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.dispatch(retptr, addHeapObject(action), addHeapObject(field), addHeapObject(location_hash));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    if (r1) {
      throw takeObject(r0);
    }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * @param {any} stream
 * @returns {any}
 */
function encode_stream(stream) {
  var ret = wasm.encode_stream(addHeapObject(stream));
  return takeObject(ret);
}

/**
 * @param {any} field
 * @returns {any}
 */
function get_state(field) {
  try {
    var retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.get_state(retptr, addHeapObject(field));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * @param {Function} emit_to_ui
 * @returns {Promise<void>}
 */
function initialize_runtime(emit_to_ui) {
  var ret = wasm.initialize_runtime(addHeapObject(emit_to_ui));
  return takeObject(ret);
}
function start() {
  wasm.start();
}

/**
 * webOS port (F8.7): the code a title's Details runs, run once in advance on a copy of the model.
 *
 * In wasm2js on the webOS TV 4.x (V8 5.8 with "--no-crankshaft") the first run of a code path of the core
 * costs hundreds of ms (the functions are compiled when first called: the first `dispatch` took ~700 ms on
 * the C8 profile, the next ones 1-2 ms), and opening the first title of a session paid it for the meta and
 * the streams answers, an addon that fails and the `get_state` of the details. Called by the page when the
 * app is idle: a copy of the runtime's model (copying it makes no effect) gets the Details of a movie and of
 * a series episode, set up as the Load leaves them (the requests loading), canned answers read as `fetch` reads
 * an addon's answer (one stream addon answers an error) and its `get_state('meta_details')`; the Load
 * action is only parsed (its update would make the requests: the core's fetch starts when the effect is
 * built). The copy's effects are dropped: nothing reaches the runtime, the storage, the network or the page.
 * One request is made on purpose, through the runtime's fetch: the streaming server's local addon
 * (127.0.0.1:11470; the core asks it on every Details, and there is no server on the TV), which fails at once
 * and warms fetch's error path. Returns how many titles it went through (0 when the runtime is not ready).
 * @returns {number}
 */
function webos_warm_up() {
  var ret = wasm.webos_warm_up();
  return ret >>> 0;
}
function __wbg_get_imports() {
  var import0 = {
    __proto__: null,
    __wbg___wbindgen_debug_string_edece8177ad01481: function __wbg___wbindgen_debug_string_edece8177ad01481(arg0, arg1) {
      var ret = debugString(getObject(arg1));
      var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function __wbg___wbindgen_is_function_5cd60d5cf78b4eef(arg0) {
      var ret = typeof getObject(arg0) === 'function';
      return ret;
    },
    __wbg___wbindgen_is_object_b4593df85baada48: function __wbg___wbindgen_is_object_b4593df85baada48(arg0) {
      var val = getObject(arg0);
      var ret = (0, _typeof2["default"])(val) === 'object' && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_string_dde0fd9020db4434: function __wbg___wbindgen_is_string_dde0fd9020db4434(arg0) {
      var ret = typeof getObject(arg0) === 'string';
      return ret;
    },
    __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5(arg0) {
      var ret = getObject(arg0) === undefined;
      return ret;
    },
    __wbg___wbindgen_string_get_d109740c0d18f4d7: function __wbg___wbindgen_string_get_d109740c0d18f4d7(arg0, arg1) {
      var obj = getObject(arg1);
      var ret = typeof obj === 'string' ? obj : undefined;
      var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_9c31b086c2b26051: function __wbg___wbindgen_throw_9c31b086c2b26051(arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg__wbg_cb_unref_3fa391f3fcdb55f8: function __wbg__wbg_cb_unref_3fa391f3fcdb55f8(arg0) {
      getObject(arg0)._wbg_cb_unref();
    },
    __wbg_call_dfde26266607c996: function __wbg_call_dfde26266607c996() {
      return handleError(function (arg0, arg1, arg2) {
        var ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_crypto_0a92367f02a93895: function __wbg_crypto_0a92367f02a93895(arg0) {
      var ret = getObject(arg0).crypto;
      return addHeapObject(ret);
    },
    __wbg_error_a6fa202b58aa1cd3: function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
      var deferred0_0;
      var deferred0_1;
      try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
      }
    },
    __wbg_fetch_c6f0d65561ded911: function __wbg_fetch_c6f0d65561ded911(arg0, arg1) {
      var ret = getObject(arg0).fetch(getObject(arg1));
      return addHeapObject(ret);
    },
    __wbg_getRandomValues_d3f1739dc62f980a: function __wbg_getRandomValues_d3f1739dc62f980a() {
      return handleError(function (arg0, arg1) {
        getObject(arg0).getRandomValues(getObject(arg1));
      }, arguments);
    },
    __wbg_getTimezoneOffset_96cfb6ddebc9e5ca: function __wbg_getTimezoneOffset_96cfb6ddebc9e5ca(arg0) {
      var ret = getObject(arg0).getTimezoneOffset();
      return ret;
    },
    __wbg_get_location_hash_49bb3550ae991d33: function __wbg_get_location_hash_49bb3550ae991d33() {
      return handleError(function () {
        var ret = self.get_location_hash();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_instanceof_Error_b3f7e146d654031a: function __wbg_instanceof_Error_b3f7e146d654031a(arg0) {
      var result;
      try {
        result = getObject(arg0) instanceof Error;
      } catch (_) {
        result = false;
      }
      var ret = result;
      return ret;
    },
    __wbg_instanceof_Response_e5ecb2743393c4a2: function __wbg_instanceof_Response_e5ecb2743393c4a2(arg0) {
      var result;
      try {
        result = getObject(arg0) instanceof Response;
      } catch (_) {
        result = false;
      }
      var ret = result;
      return ret;
    },
    __wbg_instanceof_WorkerGlobalScope_54542d5589dfb0ba: function __wbg_instanceof_WorkerGlobalScope_54542d5589dfb0ba(arg0) {
      var result;
      try {
        result = getObject(arg0) instanceof WorkerGlobalScope;
      } catch (_) {
        result = false;
      }
      var ret = result;
      return ret;
    },
    __wbg_language_1ce90e43e76abd5e: function __wbg_language_1ce90e43e76abd5e(arg0, arg1) {
      var ret = getObject(arg1).language;
      var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_length_56fcd3e2b7e0299d: function __wbg_length_56fcd3e2b7e0299d(arg0) {
      var ret = getObject(arg0).length;
      return ret;
    },
    __wbg_local_storage_get_item_24359f799c71990e: function __wbg_local_storage_get_item_24359f799c71990e() {
      return handleError(function (arg0, arg1) {
        var deferred0_0;
        var deferred0_1;
        try {
          deferred0_0 = arg0;
          deferred0_1 = arg1;
          var ret = self.local_storage_get_item(getStringFromWasm0(arg0, arg1));
          return addHeapObject(ret);
        } finally {
          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
      }, arguments);
    },
    __wbg_local_storage_remove_item_46114bc462361306: function __wbg_local_storage_remove_item_46114bc462361306() {
      return handleError(function (arg0, arg1) {
        var deferred0_0;
        var deferred0_1;
        try {
          deferred0_0 = arg0;
          deferred0_1 = arg1;
          var ret = self.local_storage_remove_item(getStringFromWasm0(arg0, arg1));
          return addHeapObject(ret);
        } finally {
          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
      }, arguments);
    },
    __wbg_local_storage_set_item_48c9c799991dcf28: function __wbg_local_storage_set_item_48c9c799991dcf28() {
      return handleError(function (arg0, arg1, arg2, arg3) {
        var deferred0_0;
        var deferred0_1;
        var deferred1_0;
        var deferred1_1;
        try {
          deferred0_0 = arg0;
          deferred0_1 = arg1;
          deferred1_0 = arg2;
          deferred1_1 = arg3;
          var ret = self.local_storage_set_item(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
          return addHeapObject(ret);
        } finally {
          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
          wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }, arguments);
    },
    __wbg_log_0c201ade58bb55e1: function __wbg_log_0c201ade58bb55e1(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
      var deferred0_0;
      var deferred0_1;
      try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
      }
    },
    __wbg_log_ce2c4456b290c5e7: function __wbg_log_ce2c4456b290c5e7(arg0, arg1) {
      var deferred0_0;
      var deferred0_1;
      try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.log(getStringFromWasm0(arg0, arg1));
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
      }
    },
    __wbg_mark_b4d943f3bc2d2404: function __wbg_mark_b4d943f3bc2d2404(arg0, arg1) {
      performance.mark(getStringFromWasm0(arg0, arg1));
    },
    __wbg_measure_84362959e621a2c1: function __wbg_measure_84362959e621a2c1() {
      return handleError(function (arg0, arg1, arg2, arg3) {
        var deferred0_0;
        var deferred0_1;
        var deferred1_0;
        var deferred1_1;
        try {
          deferred0_0 = arg0;
          deferred0_1 = arg1;
          deferred1_0 = arg2;
          deferred1_1 = arg3;
          performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
        } finally {
          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
          wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }, arguments);
    },
    __wbg_message_324ac511aeaf710e: function __wbg_message_324ac511aeaf710e(arg0) {
      var ret = getObject(arg0).message;
      return addHeapObject(ret);
    },
    __wbg_msCrypto_bcce18ddb1ca6c2d: function __wbg_msCrypto_bcce18ddb1ca6c2d(arg0) {
      var ret = getObject(arg0).msCrypto;
      return addHeapObject(ret);
    },
    __wbg_navigator_db7d86c168d224ca: function __wbg_navigator_db7d86c168d224ca(arg0) {
      var ret = getObject(arg0).navigator;
      return addHeapObject(ret);
    },
    __wbg_new_02d162bc6cf02f60: function __wbg_new_02d162bc6cf02f60() {
      var ret = new Object();
      return addHeapObject(ret);
    },
    __wbg_new_227d7c05414eb861: function __wbg_new_227d7c05414eb861() {
      var ret = new Error();
      return addHeapObject(ret);
    },
    __wbg_new_859b9002e2668e82: function __wbg_new_859b9002e2668e82(arg0) {
      var ret = new Date(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_new_typed_c072c4ce9a2a0cdf: function __wbg_new_typed_c072c4ce9a2a0cdf(arg0, arg1) {
      try {
        var state0 = {
          a: arg0,
          b: arg1
        };
        var cb0 = function cb0(arg0, arg1) {
          var a = state0.a;
          state0.a = 0;
          try {
            return wasm_bindgen__convert__closures_____invoke__h2d2933fa3d62a491(a, state0.b, arg0, arg1);
          } finally {
            state0.a = a;
          }
        };
        var ret = new Promise(cb0);
        return addHeapObject(ret);
      } finally {
        state0.a = 0;
      }
    },
    __wbg_new_with_length_99887c91eae4abab: function __wbg_new_with_length_99887c91eae4abab(arg0) {
      var ret = new Uint8Array(arg0 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_new_with_str_and_init_b298076a99bf2a5a: function __wbg_new_with_str_and_init_b298076a99bf2a5a() {
      return handleError(function (arg0, arg1, arg2) {
        var ret = new Request(getStringFromWasm0(arg0, arg1), getObject(arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_node_8ae12470cbc10fa7: function __wbg_node_8ae12470cbc10fa7(arg0) {
      var ret = getObject(arg0).node;
      return addHeapObject(ret);
    },
    __wbg_now_81363d44c96dd239: function __wbg_now_81363d44c96dd239() {
      var ret = Date.now();
      return ret;
    },
    __wbg_parse_2c1cad6215e84999: function __wbg_parse_2c1cad6215e84999() {
      return handleError(function (arg0, arg1) {
        var ret = JSON.parse(getStringFromWasm0(arg0, arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_process_c9cfbc1e2919260e: function __wbg_process_c9cfbc1e2919260e(arg0) {
      var ret = getObject(arg0).process;
      return addHeapObject(ret);
    },
    __wbg_prototypesetcall_5f9bdc8d75e07276: function __wbg_prototypesetcall_5f9bdc8d75e07276(arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
    },
    __wbg_queueMicrotask_78d584b53af520f5: function __wbg_queueMicrotask_78d584b53af520f5(arg0) {
      var ret = getObject(arg0).queueMicrotask;
      return addHeapObject(ret);
    },
    __wbg_queueMicrotask_b39ea83c7f01971a: function __wbg_queueMicrotask_b39ea83c7f01971a(arg0) {
      queueMicrotask(getObject(arg0));
    },
    __wbg_randomFillSync_143a36904a882f2a: function __wbg_randomFillSync_143a36904a882f2a() {
      return handleError(function (arg0, arg1) {
        getObject(arg0).randomFillSync(takeObject(arg1));
      }, arguments);
    },
    __wbg_require_def5a4782aa802ec: function __wbg_require_def5a4782aa802ec() {
      return handleError(function () {
        var ret = module.require;
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_resolve_d17db9352f5a220e: function __wbg_resolve_d17db9352f5a220e(arg0) {
      var ret = Promise.resolve(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_setInterval_9f3fb04a7c15cf98: function __wbg_setInterval_9f3fb04a7c15cf98() {
      return handleError(function (arg0, arg1, arg2) {
        var ret = getObject(arg0).setInterval(getObject(arg1), arg2);
        return ret;
      }, arguments);
    },
    __wbg_set_a0e911be3da02782: function __wbg_set_a0e911be3da02782() {
      return handleError(function (arg0, arg1, arg2) {
        var ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
        return ret;
      }, arguments);
    },
    __wbg_stack_3b0d974bbf31e44f: function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
      var ret = getObject(arg1).stack;
      var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_static_accessor_APP_VERSION_ad6588e9b5307366: function __wbg_static_accessor_APP_VERSION_ad6588e9b5307366(arg0) {
      var ret = self.app_version;
      var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9() {
      var ret = typeof globalThis === 'undefined' ? null : globalThis;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54() {
      var ret = typeof global === 'undefined' ? null : global;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_SELF_9b2406c23aeb2023: function __wbg_static_accessor_SELF_9b2406c23aeb2023() {
      var ret = typeof self === 'undefined' ? null : self;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_SHELL_VERSION_e938d6b82dbe50b3: function __wbg_static_accessor_SHELL_VERSION_e938d6b82dbe50b3(arg0) {
      var _self;
      var ret = typeof self === 'undefined' ? null : (_self = self) === null || _self === void 0 ? void 0 : _self.shell_version;
      var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_static_accessor_WINDOW_b34d2126934e16ba: function __wbg_static_accessor_WINDOW_b34d2126934e16ba() {
      var ret = typeof window === 'undefined' ? null : window;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_status_2c777a07423d94bb: function __wbg_status_2c777a07423d94bb(arg0) {
      var ret = getObject(arg0).status;
      return ret;
    },
    __wbg_stringify_ef0c105b1ccc3849: function __wbg_stringify_ef0c105b1ccc3849() {
      return handleError(function (arg0) {
        var ret = JSON.stringify(getObject(arg0));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_subarray_7c6a0da8f3b4a1ba: function __wbg_subarray_7c6a0da8f3b4a1ba(arg0, arg1, arg2) {
      var ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_text_6347ea31f63c60db: function __wbg_text_6347ea31f63c60db() {
      return handleError(function (arg0) {
        var ret = getObject(arg0).text();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_then_837494e384b37459: function __wbg_then_837494e384b37459(arg0, arg1) {
      var ret = getObject(arg0).then(getObject(arg1));
      return addHeapObject(ret);
    },
    __wbg_then_bd927500e8905df2: function __wbg_then_bd927500e8905df2(arg0, arg1, arg2) {
      var ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
      return addHeapObject(ret);
    },
    __wbg_versions_a8a74c7ca68bfe73: function __wbg_versions_a8a74c7ca68bfe73(arg0) {
      var ret = getObject(arg0).versions;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000001: function __wbindgen_cast_0000000000000001(arg0, arg1) {
      // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 2221, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
      var ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h09e5e79ae7d953ce);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000002: function __wbindgen_cast_0000000000000002(arg0, arg1) {
      // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 811, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
      var ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hfc8fcfa0cce7baed);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000003: function __wbindgen_cast_0000000000000003(arg0) {
      // Cast intrinsic for `F64 -> Externref`.
      var ret = arg0;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000004: function __wbindgen_cast_0000000000000004(arg0, arg1) {
      // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
      var ret = getArrayU8FromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000005: function __wbindgen_cast_0000000000000005(arg0, arg1) {
      // Cast intrinsic for `Ref(String) -> Externref`.
      var ret = getStringFromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_object_clone_ref: function __wbindgen_object_clone_ref(arg0) {
      var ret = getObject(arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_drop_ref: function __wbindgen_object_drop_ref(arg0) {
      takeObject(arg0);
    }
  };
  return {
    __proto__: null,
    "./stremio_core_web_bg.js": import0
  };
}
function wasm_bindgen__convert__closures_____invoke__hfc8fcfa0cce7baed(arg0, arg1) {
  wasm.wasm_bindgen__convert__closures_____invoke__hfc8fcfa0cce7baed(arg0, arg1);
}
function wasm_bindgen__convert__closures_____invoke__h09e5e79ae7d953ce(arg0, arg1, arg2) {
  try {
    var retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.wasm_bindgen__convert__closures_____invoke__h09e5e79ae7d953ce(retptr, arg0, arg1, addHeapObject(arg2));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    if (r1) {
      throw takeObject(r0);
    }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function wasm_bindgen__convert__closures_____invoke__h2d2933fa3d62a491(arg0, arg1, arg2, arg3) {
  wasm.wasm_bindgen__convert__closures_____invoke__h2d2933fa3d62a491(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}
function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  var idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
var CLOSURE_DTORS = typeof FinalizationRegistry === 'undefined' ? {
  register: function register() {},
  unregister: function unregister() {}
} : new FinalizationRegistry(function (state) {
  return wasm.__wbindgen_destroy_closure(state.a, state.b);
});
function debugString(val) {
  // primitive types
  var type = (0, _typeof2["default"])(val);
  if (type == 'number' || type == 'boolean' || val == null) {
    return "".concat(val);
  }
  if (type == 'string') {
    return "\"".concat(val, "\"");
  }
  if (type == 'symbol') {
    var description = val.description;
    if (description == null) {
      return 'Symbol';
    } else {
      return "Symbol(".concat(description, ")");
    }
  }
  if (type == 'function') {
    var name = val.name;
    if (typeof name == 'string' && name.length > 0) {
      return "Function(".concat(name, ")");
    } else {
      return 'Function';
    }
  }
  // objects
  if (Array.isArray(val)) {
    var length = val.length;
    var debug = '[';
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (var i = 1; i < length; i++) {
      debug += ', ' + debugString(val[i]);
    }
    debug += ']';
    return debug;
  }
  // Test for built-in
  var builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  var className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val);
  }
  if (className == 'Object') {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return 'Object(' + JSON.stringify(val) + ')';
    } catch (_) {
      return 'Object';
    }
  }
  // errors
  if (val instanceof Error) {
    return "".concat(val.name, ": ").concat(val.message, "\n").concat(val.stack);
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className;
}
function dropObject(idx) {
  if (idx < 1028) return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function getObject(idx) {
  return heap[idx];
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e));
  }
}
var heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);
var heap_next = heap.length;
function isLikeNone(x) {
  return x === undefined || x === null;
}
function makeMutClosure(arg0, arg1, f) {
  var state = {
    a: arg0,
    b: arg1,
    cnt: 1
  };
  var real = function real() {
    // First up with a closure we increment the internal reference
    // count. This ensures that the Rust closure environment won't
    // be deallocated while we're invoking it.
    state.cnt++;
    var a = state.a;
    state.a = 0;
    try {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      return f.apply(void 0, [a, state.b].concat(args));
    } finally {
      state.a = a;
      real._wbg_cb_unref();
    }
  };
  real._wbg_cb_unref = function () {
    if (--state.cnt === 0) {
      wasm.__wbindgen_destroy_closure(state.a, state.b);
      state.a = 0;
      CLOSURE_DTORS.unregister(state);
    }
  };
  CLOSURE_DTORS.register(real, state, state);
  return real;
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    var buf = cachedTextEncoder.encode(arg);
    var _ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(_ptr, _ptr + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return _ptr;
  }
  var len = arg.length;
  var ptr = malloc(len, 1) >>> 0;
  var mem = getUint8ArrayMemory0();
  var offset = 0;
  for (; offset < len; offset++) {
    var code = arg.charCodeAt(offset);
    if (code > 0x7F) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    var view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    var ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
function takeObject(idx) {
  var ret = getObject(idx);
  dropObject(idx);
  return ret;
}
var cachedTextDecoder = new TextDecoder('utf-8', {
  ignoreBOM: true,
  fatal: true
});
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder('utf-8', {
      ignoreBOM: true,
      fatal: true
    });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder();
if (!('encodeInto' in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    var buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
var WASM_VECTOR_LEN = 0;
var wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
  wasmInstance = instance;
  wasm = instance.exports;
  wasmModule = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
function __wbg_load(_x, _x2) {
  return _wbg_load.apply(this, arguments);
}
function _wbg_load() {
  _wbg_load = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee(module, imports) {
    var validResponse, bytes, instance, expectedResponseType;
    return _regenerator["default"].wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          expectedResponseType = function _expectedResponseType(type) {
            switch (type) {
              case 'basic':
              case 'cors':
              case 'default':
                return true;
            }
            return false;
          };
          if (!(module && typeof module.webosInstantiate === "function")) {
            _context.next = 5;
            break;
          }
          _context.next = 4;
          return module.webosInstantiate(imports);
        case 4:
          return _context.abrupt("return", _context.sent);
        case 5:
          if (!(typeof Response === 'function' && module instanceof Response)) {
            _context.next = 29;
            break;
          }
          if (!(typeof WebAssembly.instantiateStreaming === 'function')) {
            _context.next = 21;
            break;
          }
          _context.prev = 7;
          _context.next = 10;
          return WebAssembly.instantiateStreaming(module, imports);
        case 10:
          return _context.abrupt("return", _context.sent);
        case 13:
          _context.prev = 13;
          _context.t0 = _context["catch"](7);
          validResponse = module.ok && expectedResponseType(module.type);
          if (!(validResponse && module.headers.get('Content-Type') !== 'application/wasm')) {
            _context.next = 20;
            break;
          }
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", _context.t0);
          _context.next = 21;
          break;
        case 20:
          throw _context.t0;
        case 21:
          _context.next = 23;
          return module.arrayBuffer();
        case 23:
          bytes = _context.sent;
          _context.next = 26;
          return WebAssembly.instantiate(bytes, imports);
        case 26:
          return _context.abrupt("return", _context.sent);
        case 29:
          _context.next = 31;
          return WebAssembly.instantiate(module, imports);
        case 31:
          instance = _context.sent;
          if (!(instance instanceof WebAssembly.Instance)) {
            _context.next = 36;
            break;
          }
          return _context.abrupt("return", {
            instance: instance,
            module: module
          });
        case 36:
          return _context.abrupt("return", instance);
        case 37:
        case "end":
          return _context.stop();
      }
    }, _callee, null, [[7, 13]]);
  }));
  return _wbg_load.apply(this, arguments);
}
function initSync(module) {
  if (wasm !== undefined) return wasm;
  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      var _module = module;
      module = _module.module;
    } else {
      console.warn('using deprecated parameters for `initSync()`; pass a single object instead');
    }
  }
  var imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  var instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}
function __wbg_init(_x3) {
  return _wbg_init.apply(this, arguments);
}
function _wbg_init() {
  _wbg_init = (0, _asyncToGenerator2["default"])( /*#__PURE__*/_regenerator["default"].mark(function _callee2(module_or_path) {
    var _module_or_path, imports, _yield$__wbg_load, instance, module;
    return _regenerator["default"].wrap(function _callee2$(_context2) {
      while (1) switch (_context2.prev = _context2.next) {
        case 0:
          if (!(wasm !== undefined)) {
            _context2.next = 2;
            break;
          }
          return _context2.abrupt("return", wasm);
        case 2:
          if (module_or_path !== undefined) {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
              _module_or_path = module_or_path;
              module_or_path = _module_or_path.module_or_path;
            } else {
              console.warn('using deprecated parameters for the initialization function; pass a single object instead');
            }
          }
          if (module_or_path === undefined) {
            module_or_path = new URL('stremio_core_web_bg.wasm', importMeta.url);
          }
          imports = __wbg_get_imports();
          if (typeof module_or_path === 'string' || typeof Request === 'function' && module_or_path instanceof Request || typeof URL === 'function' && module_or_path instanceof URL) {
            module_or_path = fetch(module_or_path);
          }
          _context2.t0 = __wbg_load;
          _context2.next = 9;
          return module_or_path;
        case 9:
          _context2.t1 = _context2.sent;
          _context2.t2 = imports;
          _context2.next = 13;
          return (0, _context2.t0)(_context2.t1, _context2.t2);
        case 13:
          _yield$__wbg_load = _context2.sent;
          instance = _yield$__wbg_load.instance;
          module = _yield$__wbg_load.module;
          return _context2.abrupt("return", __wbg_finalize_init(instance, module));
        case 17:
        case "end":
          return _context2.stop();
      }
    }, _callee2);
  }));
  return _wbg_init.apply(this, arguments);
}
