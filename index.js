#!/usr/bin/env node

const cli = require('@ianwalter/cli')
const execa = require('execa')
const { print } = require('@ianwalter/print')

const { _: [command, target], ...config } = cli({
  name: 'mongit',
  options: {
    docker: {
      type: 'string'
    }
  }
})

async function getCommit (key) {
  const args = ['log', '--format=%h', `--grep=^mongit-${key}$`]
  const { stdout: hash } = await execa('git', args)
  return hash
}

async function snapshot (key) {
  // Check to see if the given key already exists.
  const commit = await getCommit(key)

  // If the given snapshot key exists, inform the user and exit.
  if (commit) {
    print.fatal(`Snapshot ${key} already exists in commit ${commit}`)
    process.exit(1)
  }

  // TODO: Clear any uncommitted changes.

  // Checkout HEAD on the current branch.
  // await execa('git', ['checkout', ])

  // Run MongoDB backup.
  if (config.docker) {
    // Dump the database.
    await execa('docker', [
      'exec',
      config.docker,
      'mongodump',
      ...config.uri ? ['--uri', config.uri] : [],
      '-o',
      '/opt/dump'
    ])

    // Copy the dump to the current working directory.
    await execa('docker', ['cp', `${config.docker}:/opt/dump`, '.'])
  } else {
    // Dump the database to the current working directory.
    await execa('mongodump', config.uri ? ['--uri', config.uri] : [])
  }

  // Stage all changes.
  await execa('git', ['add', '.'])

  // Commit all changed.
  await execa('git', ['commit', '-m', `mongit-${key}`])
}

async function restore (key) {
  // Get the commit hash that matches the given key.
  const commit = await getCommit(key)

  // If the given snapshot can't be found, inform the user and exit.
  if (!commit) {
    print.fatal(`Can't find snapshot ${key}`)
    process.exit(1)
  }

  // TODO: Clear any uncommitted changes that would block a checkout.

  // Checkout out the matching commit.
  await execa('git', ['checkout', commit])

  if (config.docker) {
    // Copy the dump to the Docker container.
    await execa('docker', ['cp', './dump', `${config.docker}:/opt`])

    // Restore the dump.
    await execa('docker', [
      'exec',
      config.docker,
      'mongorestore',
      ...config.uri ? ['--uri', config.uri] : [],
      '/opt/dump'
    ])
  } else {
    // Restore the dump.
    const args = [...config.uri ? ['--uri', config.uri] : [], './dump']
    await execa('mongorestore', args)
  }
}

async function run () {
  try {
    if (command === 'init') {
      await snapshot('initial')
      print.success('mongit initialized')
    } else if (command === 'branch') {
      await execa('git', ['checkout', '-b', target])
      await snapshot(`${target}-initial`)
      print.success(`Created branch ${target}`)
    } else if (command === 'snapshot') {
      await snapshot(target)
      print.success(`Created snapshot ${target}`)
    } else if (command === 'use') {
      await restore(target)
      print.success(`Now using snapshot ${target}`)
    } else {
      print.error('Command not found:', command)
    }
  } catch (err) {
    print.error(err.stderr || err.stdout || err)
  }
}

run()
