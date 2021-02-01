const level = {
  NONE: -1,
  CRITICAL: 0,
  ERROR: 1,
  WARNING: 2,
  INFO: 3,
  VERBOSE: 4
}

var currentLevel = level.WARNING

function setLevel (level) {
  currentLevel = level
}

function log (log, level) {
  if (!(level > currentLevel)) {
    console.log(log)
  }
}

module.exports = {
    log: log,
    level: level,
    setLevel: setLevel
}
