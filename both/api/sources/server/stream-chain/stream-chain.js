import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import Stream from 'stream';
import createProgressStream from 'progress-stream';
import streamLength from 'stream-length';

import { SourceImports } from '/both/api/source-imports/source-imports';

import { ConsoleOutput } from './stream-types/console-output';
import { ConvertToUTF8 } from './stream-types/convert-to-utf8';
import { DebugLog } from './stream-types/debug-log';
import { HTTPDownload } from './stream-types/http-download';
import { MultiHTTPDownload } from './stream-types/multi-http-download';
import { ParseJSONStream } from './stream-types/parse-json-stream';
import { ParseJSONChunks } from './stream-types/parse-json-chunks';
import { ParseCSVStreamTest } from './stream-types/parse-csv-stream-test';
import { ParseCSVStream } from './stream-types/parse-csv-stream';
import { Split } from './stream-types/split';
import { TransformData } from './stream-types/transform-data';
import { TransformScript } from './stream-types/transform-script';
import { UpsertPlace } from './stream-types/upsert-place';
import { TransformJaccedeFormat } from './stream-types/transform-jaccede-format';

const zstreams = Npm.require('zstreams');

const StreamTypes = {
  ConsoleOutput,
  ConvertToUTF8,
  DebugLog,
  HTTPDownload,
  TransformScript,
  MultiHTTPDownload,
  ParseJSONStream,
  ParseJSONChunks,
  ParseCSVStreamTest,
  ParseCSVStream,
  Split,
  TransformData,
  UpsertPlace,
  TransformJaccedeFormat,
};

function cleanStackTrace(stackTrace) {
  return stackTrace
    .split('\n')
    .filter(line => !line.match(/node_modules/))
    .join('\n');
}

function setupEventHandlersOnStream({
  errorKey, progressKey, stream, sourceImportId, type, index,
}) {
  stream.on('error', Meteor.bindEnvironment(error => {
    console.log(
      'Error on', type, 'stream (#', index, 'in chain):', error, cleanStackTrace(error.stack)
    );
    const modifier = {
      $set: {
        [errorKey]: {
          reason: error.reason,
          message: error.message,
          stack: cleanStackTrace(error.stack),
          timestamp: Date.now(),
        },
        [`${progressKey}.hasError`]: true,
      },
    };
    SourceImports.update(sourceImportId, modifier);
  }));

  stream.on('end', Meteor.bindEnvironment(() => {
    const modifier = { $set: {
      finishedTimestamp: Date.now(),
    } };
    SourceImports.update(sourceImportId, modifier);
  }));
}

// Returns an array of Node.js stream objects (encapsulated in observer objects) generated
// from given stream chain configuration.
export function createStreamChain({
  // An array of objects. Each object configures a part of the stream chain.
  streamChainConfig,
  // Reference to a SourceImports document that should be updated with progress info
  sourceImportId,
  // Reference to a source that this import belongs to.
  sourceId,
}) {
  // console.log('Supported stream types:', StreamTypes);
  check(streamChainConfig, [Object]);

  let previousStream = null;

  const result = streamChainConfig.map(({ type, parameters = {}, skip = false }, index) => {
    if (!type) {
      throw new Meteor.Error(422, `Stream chain element at index ${index} must have a type.`);
    }
    if (type instanceof String) {
      throw new Meteor.Error(422, `Stream chain element type at index ${index} must be a String.`);
    }
    if (!Object.keys(StreamTypes).includes(type)) {
      throw new Meteor.Error(422, `Stream type ${type} isn't supported.`);
    }
    check(parameters, Match.ObjectIncluding({}));
    check(skip, Boolean);
    console.log('Creating', type, 'stream...');
    const streamChainElementKey = `streamChain.${index}`;
    const debugInfoKey = `${streamChainElementKey}.debugInfo`;
    const progressKey = `${streamChainElementKey}.progress`;
    const errorKey = `${streamChainElementKey}.error`;

    const onProgress = Meteor.bindEnvironment(progress => {
      if (progress.percentage === 100) {
        Object.assign(progress, { isFinished: true });
      }
      const modifier = { $set: { [progressKey]: progress } };
      SourceImports.update(sourceImportId, modifier);
    });

    // Setup parameters for stream object
    Object.assign(parameters, {
      sourceId,
      sourceImportId,
      onDebugInfo: Meteor.bindEnvironment(debugInfo => {
        const debugInfoWithPaths = {};
        Object.keys(debugInfo).forEach(key => {
          debugInfoWithPaths[`${debugInfoKey}.${key}`] = debugInfo[key];
        });
        const modifier = { $set: debugInfoWithPaths };
        SourceImports.update(sourceImportId, modifier);
      }),
    });

    if (StreamTypes[type] === undefined) {
      throw new Meteor.Error(422, `ERROR: "${type}" is not a valid stream type.`);
    }
    const runningStreamObserver = new StreamTypes[type](parameters);

    // Validate setting up Step with parameters worked
    check(runningStreamObserver.stream, Stream);

    setupEventHandlersOnStream({
      errorKey,
      progressKey,
      stream: runningStreamObserver.stream,
      sourceImportId,
      type,
      index,
    });

    const wrappedStream = runningStreamObserver.stream = zstreams(runningStreamObserver.stream);

    // if (wrappedStream.isWritableObjectMode()) {
    //
    // } else {
    //   const options = {
    //     time: 1000,
    //     speed: 1000,
    //   };
    //   const progressStream = createProgressStream(options, onProgress);
    //   wrappedStream.pipe(progressStream);
    // }

    wrappedStream.firstError(error => {
      console.log(`Error in ${type} stream:`, error);
    });

    if (skip) {
      onProgress({ isSkipped: true });
    } else {
      // Connect to previous stream's output if existing
      previousStream = previousStream ? previousStream.pipe(wrappedStream) : wrappedStream;
    }

    return runningStreamObserver;
  });

  console.log('Stream chain:', result[0].stream.getStreamChain());

  result[result.length - 1].stream.intoCallback((error) => {
    console.log('Stream chain ended with error', error);
  });

  return result;
}
