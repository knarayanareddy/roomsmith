package com.roomsmith.puzzle

import java.nio.file.Files

object PuzzleEngineTestSuite {
    private var passed = 0

    private val alignment = PuzzleRequirement(
        subject = "red_cup",
        predicate = "left_of",
        target = "book",
        minConfidence = 0.70,
        normalizedMargin = 0.05
    )
    private val openPalm = PuzzleRequirement("hand", "open_palm", minConfidence = 0.75)
    private val sequenceRequirements = listOf(
        PuzzleRequirement("blue_cup", "inside_zone", "zone_lens", 0.70, minimumOverlap = 0.60),
        PuzzleRequirement(
            "book",
            "inside_zone",
            "zone_archive",
            0.70,
            minimumOverlap = 0.60,
            maxIntervalAfterPreviousMs = 30_000
        )
    )

    private fun engine(noTiming: Boolean = false) = PuzzleEngine(
        sessionId = "fixture-session",
        calibrationVersion = "mat-v1",
        objectKitVersion = "kit-v1",
        noTimingMode = noTiming
    )

    private fun observation(
        puzzleId: String = "lighthouse_alignment",
        subject: String = "red_cup",
        predicate: String = "left_of",
        target: String? = "book",
        confidence: Double = 0.90,
        margin: Double? = 0.10,
        overlap: Double? = null,
        at: Long,
        sequence: Long,
        valid: Boolean = true,
        present: Boolean = true
    ) = Observation(
        puzzleId = puzzleId,
        sessionId = "fixture-session",
        calibrationVersion = "mat-v1",
        objectKitVersion = "kit-v1",
        subject = subject,
        predicate = predicate,
        target = target,
        confidence = confidence,
        normalizedMargin = margin,
        overlap = overlap,
        observedAtMs = at,
        sequence = sequence,
        calibrationValid = valid,
        candidatePresent = present
    )

    private fun remotePuzzles() = listOf(
        RemotePuzzle(
            "lighthouse_alignment",
            RemoteInteraction.SINGLE_CHOICE,
            listOf("option_red_left"),
            authoredHints = listOf("Compare the labeled lens and book positions.")
        ),
        RemotePuzzle(
            "raise_the_shield",
            RemoteInteraction.HOLD,
            listOf("option_shield"),
            holdMs = 750,
            authoredHints = listOf("Use the large shield control; no camera is needed.")
        ),
        RemotePuzzle(
            "lens_archive_sequence",
            RemoteInteraction.ORDERED_ACTIONS,
            listOf("option_lens_then_archive")
        )
    )

    private fun remoteSession(
        noTiming: Boolean = false,
        snapshot: RemoteEpisodeSnapshot = RemoteEpisodeSnapshot()
    ) = RemoteEpisodeSession(
        sessionId = "fixture-session",
        episodeId = "fixture-lighthouse",
        contentVersion = "0.1.0",
        puzzles = remotePuzzles(),
        noTimingMode = noTiming,
        initialSnapshot = snapshot
    )

    private fun expect(name: String, block: () -> Unit) {
        block()
        passed += 1
        println("PASS $name")
    }

    @JvmStatic
    fun main(args: Array<String>) {
        expect("short alignment hold does not complete") {
            val game = engine()
            check(game.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1)).isEmpty())
            check(game.submit(listOf(alignment), 1000, observation(at = 500, sequence = 2)).isEmpty())
        }
        expect("stable alignment completes exactly once") {
            val game = engine()
            game.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1))
            val events = game.submit(listOf(alignment), 1000, observation(at = 1000, sequence = 2))
            check(events.size == 1)
            check(game.submit(listOf(alignment), 1000, observation(at = 1100, sequence = 3)).isEmpty())
            check(game.caseReport().size == 1)
        }
        expect("wrong relation and low confidence never succeed") {
            val game = engine()
            check(game.submit(listOf(alignment), 0, observation(predicate = "right_of", at = 0, sequence = 1)).isEmpty())
            check(game.submit(listOf(alignment), 0, observation(confidence = 0.69, at = 0, sequence = 2)).isEmpty())
            check(game.submit(listOf(alignment), 0, observation(margin = 0.01, at = 0, sequence = 3)).isEmpty())
            check(game.submit(listOf(alignment), 0, observation(subject = "unknown_cup", at = 0, sequence = 4)).isEmpty())
        }
        expect("open palm requires confidence and hold") {
            val game = engine()
            check(game.submit(listOf(openPalm), 750, observation(puzzleId = "raise_the_shield", subject = "hand", predicate = "open_palm", target = null, confidence = 0.74, margin = null, at = 0, sequence = 1)).isEmpty())
            game.submit(listOf(openPalm), 750, observation(puzzleId = "raise_the_shield", subject = "hand", predicate = "open_palm", target = null, margin = null, at = 0, sequence = 2))
            check(game.submit(listOf(openPalm), 750, observation(puzzleId = "raise_the_shield", subject = "hand", predicate = "open_palm", target = null, margin = null, at = 500, sequence = 3)).isEmpty())
            check(game.submit(listOf(openPalm), 750, observation(puzzleId = "raise_the_shield", subject = "hand", predicate = "open_palm", target = null, margin = null, at = 750, sequence = 4)).size == 1)
        }
        expect("calibration loss cancels the active hold") {
            val game = engine()
            game.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1))
            game.submit(listOf(alignment), 1000, observation(at = 500, sequence = 2, valid = false))
            game.submit(listOf(alignment), 1000, observation(at = 1500, sequence = 3))
            check(game.submit(listOf(alignment), 1000, observation(at = 2000, sequence = 4)).isEmpty())
            check(game.submit(listOf(alignment), 1000, observation(at = 2500, sequence = 5)).size == 1)
        }
        expect("one missing candidate is tolerated but not two") {
            val tolerant = engine()
            tolerant.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1))
            tolerant.submit(listOf(alignment), 1000, observation(at = 500, sequence = 2, present = false))
            check(tolerant.submit(listOf(alignment), 1000, observation(at = 1000, sequence = 3)).size == 1)

            val reset = engine()
            reset.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1))
            reset.submit(listOf(alignment), 1000, observation(at = 400, sequence = 2, present = false))
            reset.submit(listOf(alignment), 1000, observation(at = 500, sequence = 3, present = false))
            check(reset.submit(listOf(alignment), 1000, observation(at = 1000, sequence = 4)).isEmpty())
        }
        expect("stale observations cannot complete or replay") {
            val game = engine()
            game.submit(listOf(alignment), 1000, observation(at = 0, sequence = 1))
            check(game.submit(listOf(alignment), 1000, observation(at = 1000, sequence = 1)).isEmpty())
            check(game.submit(listOf(alignment), 1000, observation(at = 999, sequence = 0)).isEmpty())
            check(game.submit(listOf(alignment), 1000, observation(at = 1000, sequence = 2)).size == 1)
        }
        expect("wrong sequence order is rejected") {
            val game = engine()
            val wrong = observation(puzzleId = "lens_archive_sequence", subject = "book", predicate = "inside_zone", target = "zone_archive", margin = null, overlap = 0.8, at = 0, sequence = 1)
            check(game.submit(sequenceRequirements, 500, wrong).isEmpty())
            check(game.state.sequenceSteps["lens_archive_sequence"] == null)
            check(game.guidanceFor("lens_archive_sequence")?.contains("Start with step 1: blue_cup inside_zone zone_lens") == true)
            val lens = observation(puzzleId = "lens_archive_sequence", subject = "blue_cup", predicate = "inside_zone", target = "zone_lens", margin = null, overlap = 0.8, at = 500, sequence = 2)
            check(game.submit(sequenceRequirements, 500, lens).isEmpty())
            check(game.guidanceFor("lens_archive_sequence") == null)
        }
        expect("ordered stable sequence completes") {
            val game = engine()
            val lens = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "blue_cup", predicate = "inside_zone", target = "zone_lens", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            val book = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "book", predicate = "inside_zone", target = "zone_archive", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            game.submit(sequenceRequirements, 500, lens(0, 1))
            game.submit(sequenceRequirements, 500, lens(500, 2))
            game.submit(sequenceRequirements, 500, book(1000, 3))
            check(game.submit(sequenceRequirements, 500, book(1500, 4)).size == 1)
        }
        expect("sequence timeout resets standard mode") {
            val game = engine()
            val lens = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "blue_cup", predicate = "inside_zone", target = "zone_lens", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            val book = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "book", predicate = "inside_zone", target = "zone_archive", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            game.submit(sequenceRequirements, 500, lens(0, 1))
            game.submit(sequenceRequirements, 500, lens(500, 2))
            game.submit(sequenceRequirements, 500, book(31_000, 3))
            check(game.submit(sequenceRequirements, 500, book(31_500, 4)).isEmpty())
        }
        expect("no-timing preserves order without interval failure") {
            val game = engine(noTiming = true)
            val lens = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "blue_cup", predicate = "inside_zone", target = "zone_lens", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            val book = { at: Long, sequence: Long -> observation(puzzleId = "lens_archive_sequence", subject = "book", predicate = "inside_zone", target = "zone_archive", margin = null, overlap = 0.8, at = at, sequence = sequence) }
            game.submit(sequenceRequirements, 500, lens(0, 1))
            game.submit(sequenceRequirements, 500, lens(500, 2))
            game.submit(sequenceRequirements, 500, book(31_000, 3))
            check(game.submit(sequenceRequirements, 500, book(31_500, 4)).size == 1)
        }
        expect("remote fallback uses authored answer and expected sequence") {
            val game = engine()
            check(game.commitRemote("lighthouse_alignment", listOf("option_red_left"), listOf("option_red_right"), 0).isEmpty())
            check(game.state.stateSequence == 0L)
            check(runCatching {
                game.commitRemote("lighthouse_alignment", listOf("option_red_left", "option_red_left"), listOf("option_red_left", "option_red_left"), 0)
            }.isFailure)
            check(game.commitRemote("lighthouse_alignment", listOf("option_red_left"), listOf("option_red_left"), 0).size == 1)
            check(game.commitRemote("lighthouse_alignment", listOf("option_red_left"), listOf("option_red_left"), 0).isEmpty())
        }
        expect("resumed completion does not replay and report has no media") {
            val completion = CompletedPuzzle("lighthouse_alignment", CompletionPath.REMOTE, 1)
            val resumed = PuzzleEngine("fixture-session", "mat-v1", "kit-v1", initialState = EngineState(1, mapOf(completion.puzzleId to completion)))
            check(resumed.commitRemote("lighthouse_alignment", listOf("option_red_left"), listOf("option_red_left"), 1).isEmpty())
            check(resumed.caseReport() == listOf(completion))
        }
        expect("remote episode enforces authored order and answers") {
            val session = remoteSession()
            check(runCatching {
                session.submitRemote("lens_archive_sequence", listOf("option_lens_then_archive"), 0, 0)
            }.isFailure)
            check(session.submitRemote("lighthouse_alignment", listOf("option_red_right"), 0, 0).isEmpty())
            check(session.snapshot.engineState.stateSequence == 0L)
            check(session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 1).size == 1)

            val ordered = RemoteEpisodeSession(
                "fixture-session",
                "fixture-lighthouse",
                "0.1.0",
                listOf(
                    RemotePuzzle(
                        "ordered",
                        RemoteInteraction.ORDERED_ACTIONS,
                        listOf("lens", "archive")
                    )
                )
            )
            check(ordered.submitRemote("ordered", listOf("archive", "lens"), 0, 0).isEmpty())
            check(ordered.snapshot.engineState.stateSequence == 0L)
            check(ordered.submitRemote("ordered", listOf("lens", "archive"), 0, 1).size == 1)
        }
        expect("remote hold respects duration and no-timing selection") {
            val standard = remoteSession()
            standard.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
            check(standard.submitRemote("raise_the_shield", listOf("option_shield"), 1, 100).isEmpty())
            check(standard.submitRemote("raise_the_shield", listOf("option_shield"), 1, 500).isEmpty())
            check(standard.submitRemote("raise_the_shield", listOf("option_shield"), 1, 850).size == 1)

            val noTiming = remoteSession(noTiming = true)
            noTiming.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
            check(noTiming.submitRemote("raise_the_shield", listOf("option_shield"), 1, 0).size == 1)
        }
        expect("remote snapshot resumes hints and media-free case metadata") {
            val session = remoteSession(noTiming = true)
            session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
            val hint = session.authoredHint("raise_the_shield", 1, 1)
            check(session.authoredHint("raise_the_shield", 1, 1) == hint)
            check(session.snapshot.hintsUsed["raise_the_shield"] == 1)
            check(session.snapshot.engineState.stateSequence == 1L)

            val resumed = remoteSession(noTiming = true, snapshot = session.snapshot)
            resumed.submitRemote("raise_the_shield", listOf("option_shield"), 1, 10)
            resumed.recordActiveTime(1200)
            resumed.submitRemote("lens_archive_sequence", listOf("option_lens_then_archive"), 2, 20)
            val report = resumed.caseReport()
            check(report.completedPuzzles.size == 3)
            check(report.completedPuzzles.all { it.path == CompletionPath.REMOTE && it.observationSequence == null })
            check(report.hintsUsed == mapOf("raise_the_shield" to 1))
            check(report.elapsedActiveTimeMs == 1200L)
        }
        expect("remote stale commits fail and completed duplicates are ignored") {
            val session = remoteSession()
            check(runCatching {
                session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 1, 0)
            }.isFailure)
            session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
            val committed = session.snapshot
            check(session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 1).isEmpty())
            check(session.snapshot == committed)
        }
        expect("remote report and authored definitions fail closed") {
            val session = remoteSession()
            check(runCatching { session.caseReport() }.isFailure)
            check(runCatching { session.recordActiveTime(-1) }.isFailure)
            check(runCatching { session.authoredHint("raise_the_shield", 1, 0) }.isFailure)
            check(runCatching {
                RemoteEpisodeSession(
                    "fixture-session",
                    "fixture-lighthouse",
                    "0.1.0",
                    listOf(remotePuzzles()[0], remotePuzzles()[0])
                )
            }.isFailure)
            check(runCatching {
                remoteSession(snapshot = RemoteEpisodeSnapshot(hintsUsed = mapOf("raise_the_shield" to 2)))
            }.isFailure)
            val unknown = CompletedPuzzle("unknown", CompletionPath.REMOTE, 1)
            check(runCatching {
                remoteSession(
                    snapshot = RemoteEpisodeSnapshot(
                        EngineState(1, mapOf(unknown.puzzleId to unknown))
                    )
                )
            }.isFailure)
        }
        expect("atomic fixture file reopens remote hints and completions") {
            val directory = Files.createTempDirectory("roomsmith-episode-test-")
            val path = directory.resolve("episode.snapshot")
            try {
                val store = RemoteEpisodeFileStore(path)
                val session = remoteSession(noTiming = true)
                session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
                session.authoredHint("raise_the_shield", 1, 1)
                store.save(session.snapshot)
                val firstBytes = Files.readAllBytes(path)
                store.save(session.snapshot)
                check(Files.readAllBytes(path).contentEquals(firstBytes))

                val reopenedSnapshot = RemoteEpisodeFileStore(path).load()
                check(reopenedSnapshot == session.snapshot)
                val resumed = remoteSession(noTiming = true, snapshot = reopenedSnapshot)
                resumed.submitRemote("raise_the_shield", listOf("option_shield"), 1, 10)
                resumed.recordActiveTime(1200)
                resumed.submitRemote("lens_archive_sequence", listOf("option_lens_then_archive"), 2, 20)
                store.save(resumed.snapshot)

                val completed = remoteSession(
                    noTiming = true,
                    snapshot = RemoteEpisodeFileStore(path).load()
                )
                check(completed.caseReport() == resumed.caseReport())
                check(completed.snapshot.hintsUsed["raise_the_shield"] == 1)
                check(Files.list(directory).use { it.count() } == 1L)
            } finally {
                Files.deleteIfExists(path)
                Files.deleteIfExists(directory)
            }
        }
        expect("reopening cannot bypass a transient remote hold") {
            val directory = Files.createTempDirectory("roomsmith-hold-test-")
            val path = directory.resolve("episode.snapshot")
            try {
                val store = RemoteEpisodeFileStore(path)
                val session = remoteSession()
                session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
                check(session.submitRemote("raise_the_shield", listOf("option_shield"), 1, 100).isEmpty())
                store.save(session.snapshot)

                val resumed = remoteSession(snapshot = RemoteEpisodeFileStore(path).load())
                check(resumed.submitRemote("raise_the_shield", listOf("option_shield"), 1, 850).isEmpty())
                check(resumed.submitRemote("raise_the_shield", listOf("option_shield"), 1, 1600).size == 1)
            } finally {
                Files.deleteIfExists(path)
                Files.deleteIfExists(directory)
            }
        }
        expect("malformed or camera-bearing remote snapshots fail closed") {
            val directory = Files.createTempDirectory("roomsmith-snapshot-validation-")
            val path = directory.resolve("episode.snapshot")
            try {
                val store = RemoteEpisodeFileStore(path)
                val session = remoteSession()
                session.submitRemote("lighthouse_alignment", listOf("option_red_left"), 0, 0)
                store.save(session.snapshot)
                val valid = Files.readAllBytes(path)
                val invalidMagic = valid.copyOf()
                invalidMagic[0] = 'X'.code.toByte()
                Files.write(path, invalidMagic)
                check(runCatching { store.load() }.isFailure)

                Files.write(path, valid.copyOf(valid.size - 1))
                check(runCatching { store.load() }.isFailure)
                Files.write(path, valid + 0)
                check(runCatching { store.load() }.isFailure)
                val invalidChecksum = valid.copyOf()
                invalidChecksum[invalidChecksum.lastIndex] =
                    (invalidChecksum.last().toInt() xor 1).toByte()
                Files.write(path, invalidChecksum)
                check(runCatching { store.load() }.isFailure)
                val unsupportedVersion = valid.copyOf()
                unsupportedVersion[11] = 2
                Files.write(path, unsupportedVersion)
                check(runCatching { store.load() }.isFailure)

                Files.write(path, valid)
                check(runCatching {
                    store.save(RemoteEpisodeSnapshot(engineState = EngineState(stateSequence = 1)))
                }.isFailure)
                val camera = CompletedPuzzle("lighthouse_alignment", CompletionPath.CAMERA, 1, 4)
                check(runCatching {
                    store.save(
                        RemoteEpisodeSnapshot(
                            engineState = EngineState(1, mapOf(camera.puzzleId to camera))
                        )
                    )
                }.isFailure)
                check(Files.readAllBytes(path).contentEquals(valid))
            } finally {
                Files.deleteIfExists(path)
                Files.deleteIfExists(directory)
            }
        }
        println("PASS $passed Kotlin puzzle-engine tests")
    }
}
