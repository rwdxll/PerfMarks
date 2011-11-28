define([ 'sprites/sources', 'sprites/generators', 'sprites/renderers', 'util/ensureCallback', 'util/chainAsync', 'util/benchAsync' ], function (sources, generators, renderers, ensureCallback, chainAsync, benchAsync) {
    var FRAME_COUNT = 100;
    var TARGET_FRAMERATE = 30;

    function generateFrames(generator, frameCount, objectCount) {
        var frames = [ ];

        var i, j;
        for (i = 0; i < frameCount; ++i) {
            var frame = [ ];
            frames.push(frame);

            for (j = 0; j < objectCount; ++j) {
                frame.push(generator(i, j));
            }
        }

        return frames;
    }

    function runTest(sourceData, objectCount, generator, renderer, callback) {
        callback = ensureCallback(callback);

        var frames = generateFrames(generator, FRAME_COUNT, objectCount);
        var renderContext = renderer(sourceData, frames);

        renderContext.load(function (err) {
            if (err) return callback(err);

            var jsTime = 0;

            function frame(i, next) {
                setTimeout(next, 0);

                var frame = i % FRAME_COUNT;
                var jsStartTime = Date.now();
                renderContext.renderFrame(frame);
                var jsEndTime = Date.now();
                jsTime += jsEndTime - jsStartTime;
            }

            function done(err, score) {
                renderContext.unload();

                callback(null, {
                    js: jsTime,
                    fps: score
                });
            }

            return benchAsync(1000, frame, done);
        });
    }

    function runTestToFramerate(targetFramerate, sourceData, generator, renderer, callback) {
        callback = ensureCallback(callback);

        // objectCount => { js, fps }
        var fpsResults = { };

        // fps => objectCount
        var fpsLut = { };

        function done() {
            // Linearly interpolate framerate between two closest to
            // targetFramerate

            var fpsAbove = Infinity;
            var objAbove = Infinity;

            var fpsBelow = -Infinity;
            var objBelow = -Infinity;

            Object.keys(fpsLut).forEach(function (fps) {
                var objectCount = fpsLut[fps];
                fps = +fps; // Number cast

                if (fps >= targetFramerate && fps < fpsAbove) {
                    fpsAbove = fps;
                    objAbove = objectCount;
                }

                if (fps <= targetFramerate && fps > fpsBelow) {
                    fpsBelow = fps;
                    objBelow = objectCount;
                }
            });

            if (!isFinite(fpsAbove) || !isFinite(fpsBelow)) {
                callback(new Error("Bad test results"));
                return;
            }

            var x = (fpsAbove - fpsBelow) / fpsBelow;
            var objectCount = x * objBelow + (1 - x) * objAbove;
            var jsTime = x * fpsResults[objBelow].js + (1 - x) * fpsResults[objAbove].js;

            callback(null, {
                objectCount: objectCount,
                js: jsTime
            });
        }

        // Run the test in steps of 25 (0, 25, 50, 75),
        // then in steps of 5 (20, 25, 30, 35)
        // then in steps of 1 (25, 26, 27, 28)
        var objectCountSteps = [ 1, 5, 25 ];
        var objectCountStep = objectCountSteps.pop();

        function test(objectCount) {
            console.log('testing', objectCount);
            if (Object.prototype.hasOwnProperty.call(fpsResults, objectCount)) {
                // Already tested; let's say we're done here
                done();
                return;
            }

            console.log('Testing', objectCount, 'objects');
            runTest(sourceData, objectCount, generator, renderer, function testDone(err, results) {
                if (err) return callback(err);

                fpsResults[objectCount] = results;
                fpsLut[results.fps] = objectCount;

                if (results.fps < targetFramerate) {
                    // Hit too low (too many objects); go back and lower step
                    // FIXME This may infloop (I think)
                    var nextObjectCountStep = objectCountSteps.length ? objectCountSteps.pop() : 1;
                    var newObjectCount = Math.max(0, objectCount - objectCountStep + nextObjectCountStep);
                    objectCountStep = nextObjectCountStep;
                    test(newObjectCount);
                } else if (results.fps > targetFramerate) {
                    // Hit too high (too few objects); keep going
                    var newObjectCount = objectCount + objectCountStep;
                    test(newObjectCount);
                } else {
                    // Hit it exactly!  (Creepy.)
                    done();
                }
            });
        }

        test(0);
    }

    // source => renderer => generator => test
    var tests = { };

    Object.keys(sources).forEach(function (sourceName) {
        var source = sources[sourceName];

        var subTests = { };
        tests[sourceName] = subTests;

        Object.keys(renderers).forEach(function (rendererName) {
            var renderer = renderers[rendererName];

            var subSubTests = { };
            subTests[rendererName] = subSubTests;

            Object.keys(generators).forEach(function (generatorName) {
                var generator = generators[generatorName];

                subSubTests[generatorName] = function spriteTest(callback) {
                    source(function (err, sourceData) {
                        if (err) return callback(err);
                        runTestToFramerate(TARGET_FRAMERATE, sourceData, generator, renderer, callback);
                    });
                };
            });
        });
    });

    return tests;
});
