const bitbus = 'https://txo.bitbus.network/block'
const bitbusToken = 'eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxNTZLRXBBdEVhc3VqVEM5Mlo3RTU4OWN5bmVLWTFqc0J6IiwiaXNzdWVyIjoiZ2VuZXJpYy1iaXRhdXRoIn0.SUtoOWEzSzRZaTk5ZVVWY2lneENPdE05eFQ2QytBcWIrNDZmcitHN090YVVMaSt6c0NteHIra0tFa0wzQjNMSHlJQUo3WGVVbi94bkdsYTJvQzhqY0s0PQ'
const fetch = require('node-fetch')

async function get_array (query) {
  var data = JSON.stringify(query)
  var url = bitbus
  var header = {
    method: 'POST',
    body: data,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'token': bitbusToken
    }
  }
  var r
  try {
    r = await fetch(url, header)
    r = await r.text()
    r = r.trim()
    if (r != '') {
      r = r.split('\n')
    } else {
      r = []
    }
    for (var index = 0; index < r.length; ++ index) {
      r[index] = JSON.parse(r[index])
    }
    return r
  } catch (e) {
    return []
  }
}

module.exports = {
  get_array: get_array
}
