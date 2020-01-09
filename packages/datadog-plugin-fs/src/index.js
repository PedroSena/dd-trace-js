'use strict'

const tx = require('../../dd-trace/src/plugins/util/tx.js')

let kDirReadPromisified
let kDirClosePromisified

const tagMakers = {
  open: createOpenTags,
  close: createCloseTags,
  readFile: createReadFileTags,
  writeFile: createWriteFileTags,
  appendFile: createAppendFileTags,
  access: createPathTags,
  copyFile: createCopyFileTags,
  stat: createPathTags,
  lstat: createPathTags,
  fstat: createFDTags,
  readdir: createPathTags,
  opendir: createPathTags,
  read: createFDTags,
  write: createFDTags,
  writev: createFDTags,
  chmod: createChmodTags,
  lchmod: createChmodTags,
  fchmod: createFchmodTags,
  chown: createChownTags,
  lchown: createChownTags,
  fchown: createFchownTags,
  realpath: createPathTags,
  readlink: createPathTags,
  unlink: createPathTags,
  symlink: createCopyFileTags,
  link: createCopyFileTags,
  rmdir: createPathTags,
  rename: createCopyFileTags,
  fsync: createFDTags,
  fdatasync: createFDTags,
  mkdir: createPathTags,
  truncate: createPathTags,
  ftruncate: createFDTags,
  utimes: createPathTags,
  futimes: createFDTags,
  mkdtemp: createPathTags
}

function createWrapCreateReadStream (config, tracer) {
  return function wrapCreateReadStream (createReadStream) {
    return function wrappedCreateReadStream (path, options) {
      const tags = makeFSTags(path, options, 'r', config, tracer)
      return tracer.trace('fs.readstream', { tags }, (span, done) => {
        const stream = createReadStream.apply(this, arguments)
        stream.once('end', done)
        stream.once('error', done)
        return stream
      })
    }
  }
}

function createWrapCreateWriteStream (config, tracer) {
  return function wrapCreateWriteStream (createWriteStream) {
    return function wrappedCreateWriteStream (path, options) {
      const tags = makeFSTags(path, options, 'w', config, tracer)
      return tracer.trace('fs.writestream', { tags }, (span, done) => {
        const stream = createWriteStream.apply(this, arguments)
        stream.once('finish', done)
        stream.once('error', done)
        return stream
      })
    }
  }
}

function createWrapExists (config, tracer) {
  return function wrapExists (exists) {
    return function wrappedExists (path, cb) {
      if (typeof cb !== 'function') {
        return exists.apply(this, arguments)
      }
      const tags = makeFSTags(path, null, null, config, tracer)
      return tracer.trace('fs.exists', { tags }, (span, done) => {
        arguments[1] = function (result) {
          done()
          cb.apply(this, arguments)
        }
        return exists.apply(this, arguments)
      })
    }
  }
}

function createWrapDirRead (config, tracer, sync) {
  const name = sync ? 'fs.dir.readsync' : 'fs.dir.read'
  return function wrapDirRead (read) {
    function options () {
      const tags = makeFSTags(this.path, null, null, config, tracer)
      return { tags }
    }
    return tracer.wrap(name, options, read)
  }
}

function createWrapDirClose (config, tracer, sync) {
  const name = sync ? 'fs.dir.closesync' : 'fs.dir.close'
  return function wrapDirClose (close) {
    function options () {
      const tags = makeFSTags(this.path, null, null, config, tracer)
      return { tags }
    }
    return tracer.wrap(name, options, close)
  }
}

function createWrapDirAsyncIterator (config, tracer, instrumenter) {
  return function wrapDirAsyncIterator (asyncIterator) {
    return function wrappedDirAsyncIterator () {
      if (!kDirReadPromisified) {
        const keys = Reflect.ownKeys(this)
        for (const key of keys) {
          if (kDirReadPromisified && kDirClosePromisified) break
          if (typeof key !== 'symbol') continue
          if (!kDirReadPromisified && getSymbolName(key).includes('kDirReadPromisified')) {
            kDirReadPromisified = key
          }
          if (!kDirClosePromisified && getSymbolName(key).includes('kDirClosePromisified')) {
            kDirClosePromisified = key
          }
        }
      }
      instrumenter.wrap(this, kDirReadPromisified, createWrapDirRead(config, tracer))
      instrumenter.wrap(this, kDirClosePromisified, createWrapKDirClose(config, tracer, instrumenter))
      return asyncIterator.call(this)
    }
  }
}

function createWrapKDirClose (config, tracer, instrumenter) {
  return function wrapKDirClose (kDirClose) {
    return function wrappedKDirClose () {
      const tags = makeFSTags(this.path, null, null, config, tracer)
      return tracer.trace('fs.dir.close', { tags }, (span) => {
        const p = kDirClose.call(this)
        const unwrapBoth = () => {
          instrumenter.unwrap(this, kDirReadPromisified)
          instrumenter.unwrap(this, kDirClosePromisified)
        }
        p.then(unwrapBoth, unwrapBoth)
        return p
      })
    }
  }
}

function createOpenTags (config, tracer) {
  return function openTags (path, flag, mode) {
    if (!flag || typeof flag === 'function') {
      flag = null
    }
    return makeFSTags(path, { flag }, 'r', config, tracer)
  }
}

function createCloseTags (config, tracer) {
  return function closeTags (fd) {
    if (typeof fd !== 'number' || !Number.isInteger(fd)) {
      return
    }
    return makeFSTags(fd, null, null, config, tracer)
  }
}

function createReadFileTags (config, tracer) {
  return function readFileTags (path, options) {
    return makeFSTags(path, options, 'r', config, tracer)
  }
}

function createWriteFileTags (config, tracer) {
  return function writeFileTags (path, data, options) {
    return makeFSTags(path, options, 'w', config, tracer)
  }
}

function createAppendFileTags (config, tracer) {
  return function appendFileTags (path, data, options) {
    return makeFSTags(path, options, 'a', config, tracer)
  }
}

function createCopyFileTags (config, tracer) {
  return function copyFileTags (src, dest, flag) {
    if (!src || !dest) {
      return
    }
    return makeFSTags({ src, dest }, null, null, config, tracer)
  }
}

function createChmodTags (config, tracer) {
  return function chmodTags (path, mode) {
    if (typeof path === 'number' || typeof mode !== 'number') {
      return
    }
    const tags = makeFSTags(path, null, null, config, tracer)
    tags['file.mode'] = mode.toString(8)
    return tags
  }
}

function createFchmodTags (config, tracer) {
  return function fchmodTags (fd, mode) {
    if (typeof this === 'object' && this !== null && this.fd) {
      mode = fd
      fd = this.fd
    }
    if (typeof fd !== 'number' || typeof mode !== 'number') {
      return
    }
    const tags = makeFSTags(fd, null, null, config, tracer)
    tags['file.mode'] = mode.toString(8)
    return tags
  }
}

function createPathTags (config, tracer) {
  return function pathTags (path) {
    if (typeof path === 'number') {
      return
    }
    return makeFSTags(path, null, null, config, tracer)
  }
}

function createFDTags (config, tracer) {
  return function fdTags (fd) {
    if (typeof this === 'object' && this !== null && this.fd) {
      fd = this.fd
    }
    if (typeof fd !== 'number') {
      return
    }
    return makeFSTags(fd, null, null, config, tracer)
  }
}

function createChownTags (config, tracer) {
  return function chownTags (path, uid, gid) {
    if (typeof path === 'number' || typeof uid !== 'number' || typeof gid !== 'number') {
      return
    }
    const tags = makeFSTags(path, null, null, config, tracer)
    tags['file.uid'] = uid.toString()
    tags['file.gid'] = gid.toString()
    return tags
  }
}

function createFchownTags (config, tracer) {
  return function fchownTags (fd, uid, gid) {
    if (typeof this === 'object' && this !== null && this.fd) {
      gid = uid
      uid = fd
      fd = this.fd
    }
    if (typeof fd !== 'number' || typeof uid !== 'number' || typeof gid !== 'number') {
      return
    }
    const tags = makeFSTags(fd, null, null, config, tracer)
    tags['file.uid'] = uid.toString()
    tags['file.gid'] = gid.toString()
    return tags
  }
}

function getSymbolName (sym) {
  return sym.description || sym.toString()
}

function createWrapCb (tracer, config, name, tagMaker) {
  const makeTags = tagMaker(config, tracer)
  name = 'fs.' + name
  return function wrapFunction (fn) {
    return tracer.wrap(name, function () {
      if (typeof arguments[arguments.length - 1] !== 'function') {
        return
      }
      const tags = makeTags.apply(this, arguments)
      return tags ? { tags } : null
    }, fn)
  }
}

function createWrap (tracer, config, name, tagMaker) {
  const makeTags = tagMaker(config, tracer)
  name = 'fs.' + name
  return function wrapSyncFunction (fn) {
    return tracer.wrap(name, function () {
      const tags = makeTags.apply(this, arguments)
      return tags ? { tags } : null 
    }, fn)
  }
}

function makeFSTags (path, options, defaultFlag, config, tracer) {
  path = options && 'fd' in options ? options.fd : path
  if (
    typeof path !== 'number' &&
    typeof path !== 'string' &&
    (typeof path !== 'object' || path === null)
  ) {
    return
  }
  const tags = {
    'component': 'fs',
    'service.name': config.service || `${tracer._service}-fs`
  }
  if (defaultFlag) {
    tags['file.flag'] = options && options.flag
      ? options.flag
      : (options && options.flags ? options.flags : defaultFlag)
  }

  switch(typeof path) {
    case 'object': {
      const src = 'src' in path ? path.src : null
      const dest = 'dest' in path ? path.dest : null
      if (src || dest) {
        tags['file.src'] = src.toString('utf8')
        tags['file.dest'] = dest.toString('utf8')
        tags['resource.name'] = (src || dest).toString('utf8')
      } else {
        tags['file.path'] = path.toString('utf8')
        tags['resource.name'] = path.toString('utf8')
      }
      break
    }
    case 'string': {
      tags['file.path'] = path
      tags['resource.name'] = path
      break
    }
    case 'number': {
      tags['file.descriptor'] = path
      tags['resource.name'] = path.toString()
      break
    }
  }

  return tags
}

function wrapCallback (cb, done) {
  return function wrappedCallback (err, result) {
    done(err)
    return cb.apply(null, arguments)
  }
}

function getFileHandlePrototype (fs) {
  return fs.promises.open(__filename, 'r')
    .then(fh => {
      fh.close()
      return Object.getPrototypeOf(fh)
    })
}

module.exports = {
  name: 'fs',
  patch (fs, tracer, config) {
    for (const name in fs) {
      if (!fs[name]) continue
      const tagMakerName = name.endsWith('Sync') ? name.substr(0, name.length - 4) : name
      if (tagMakerName in tagMakers) {
        const tagMaker = tagMakers[tagMakerName]
        if (name.endsWith('Sync')) {
          this.wrap(fs, name, createWrap(tracer, config, name.toLowerCase(), tagMaker))
        } else {
          this.wrap(fs, name, createWrapCb(tracer, config, name.toLowerCase(), tagMaker))
        }
      }
    }
    if (fs.promises) {
      getFileHandlePrototype(fs).then(fileHandlePrototype => {
        for (const name of Reflect.ownKeys(fileHandlePrototype)) {
          if (name === 'close' && name === 'constructor' || name === 'fd' || name === 'getAsyncId') {
            continue
          }
          let tagMaker
          if ('f' + name in tagMakers) {
            tagMaker = tagMakers['f' + name]
          } else {
            tagMaker = createFDTags
          }
          this.wrap(fileHandlePrototype, name, createWrap(tracer, config, 'filehandle.' + name.toLowerCase(), tagMaker))
        }
      })
      for (const name in fs.promises) {
        if (name in tagMakers) {
          const tagMaker = tagMakers[name]
          this.wrap(fs.promises, name, createWrap(tracer, config, 'promises.' + name.toLowerCase(), tagMaker))
        }
      }
    }
    if (fs.Dir) {
      this.wrap(fs.Dir.prototype, 'close', createWrapDirClose(config, tracer))
      this.wrap(fs.Dir.prototype, 'closeSync', createWrapDirClose(config, tracer, true))
      this.wrap(fs.Dir.prototype, 'read', createWrapDirRead(config, tracer))
      this.wrap(fs.Dir.prototype, 'readSync', createWrapDirRead(config, tracer, true))
      this.wrap(fs.Dir.prototype, Symbol.asyncIterator, createWrapDirAsyncIterator(config, tracer, this))
    }
    this.wrap(fs, 'createReadStream', createWrapCreateReadStream(config, tracer))
    this.wrap(fs, 'createWriteStream', createWrapCreateWriteStream(config, tracer))
    this.wrap(fs, 'existsSync', createWrap(tracer, config, 'existssync', createPathTags))
    this.wrap(fs, 'exists', createWrapExists(config, tracer))
  },
  unpatch (fs) {
    for (const name in fs) {
      if (!fs[name]) continue
      const tagMakerName = name.endsWith('Sync') ? name.substr(0, name.length - 4) : name
      if (tagMakerName in tagMakers) {
        this.unwrap(fs, name)
      }
    }
    if (fs.promises) {
      getFileHandlePrototype(fs).then(fileHandlePrototype => {
        for (const name of Reflect.ownKeys(fileHandlePrototype)) {
          if (name === 'constructor' || name === 'fd' || name === 'getAsyncId') {
            continue
          }
          this.unwrap(fileHandlePrototype, name)
        }
      })
      for (const name in fs.promises) {
        if (name in tagMakers) {
          this.unwrap(fs.promises, name)
        }
      }
    }
    if (fs.Dir) {
      this.unwrap(fs.Dir.prototype, 'close')
      this.unwrap(fs.Dir.prototype, 'closeSync')
      this.unwrap(fs.Dir.prototype, 'read')
      this.unwrap(fs.Dir.prototype, 'readSync')
      this.unwrap(fs.Dir.prototype, Symbol.asyncIterator)
    }
    this.unwrap(fs, 'createReadStream')
    this.unwrap(fs, 'createWriteStream')
    this.unwrap(fs, 'existsSync')
    this.unwrap(fs, 'exists')
  }
}

/** TODO fs functions:

unwatchFile
watch
watchFile
*/
