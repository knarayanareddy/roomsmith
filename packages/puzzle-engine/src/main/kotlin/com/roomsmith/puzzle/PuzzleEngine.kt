package com.roomsmith.puzzle

enum class CompletionPath { CAMERA, REMOTE }

data class PuzzleRequirement(
    val subject: String,
    val predicate: String,
    val target: String? = null,
    val minConfidence: Double,
    val normalizedMargin: Double? = null,
    val minimumOverlap: Double? = null,
    val maxIntervalAfterPreviousMs: Long? = null
)

data class Observation(
    val puzzleId: String,
    val sessionId: String,
    val calibrationVersion: String,
    val objectKitVersion: String,
    val subject: String,
    val predicate: String,
    val target: String? = null,
    val confidence: Double,
    val normalizedMargin: Double? = null,
    val overlap: Double? = null,
    val observedAtMs: Long,
    val sequence: Long,
    val calibrationValid: Boolean = true,
    val needsReview: Boolean = false,
    val occluded: Boolean = false,
    val candidatePresent: Boolean = true
)

data class CompletedPuzzle(
    val puzzleId: String,
    val path: CompletionPath,
    val committedSequence: Long,
    val observationSequence: Long? = null
)

data class PuzzleCompleted(val completion: CompletedPuzzle)

data class EngineState(
    val stateSequence: Long = 0,
    val completedPuzzles: Map<String, CompletedPuzzle> = emptyMap(),
    val lastObservationSequences: Map<String, Long> = emptyMap(),
    val sequenceSteps: Map<String, Int> = emptyMap(),
    val sequenceStartedAtMs: Map<String, Long> = emptyMap()
)

private data class HoldState(
    val startedAtMs: Long,
    val lastAtMs: Long,
    val missingFrames: Int = 0
)

class PuzzleEngine(
    private val sessionId: String,
    private val calibrationVersion: String,
    private val objectKitVersion: String,
    private val noTimingMode: Boolean = false,
    initialState: EngineState = EngineState()
) {
    var state: EngineState = initialState
        private set
    private val holds = mutableMapOf<String, HoldState>()

    private fun resetHold(puzzleId: String) {
        holds.keys.removeAll { it.startsWith("$puzzleId/") }
    }

    private fun resetPuzzle(puzzleId: String) {
        resetHold(puzzleId)
        state = state.copy(
            sequenceSteps = state.sequenceSteps - puzzleId,
            sequenceStartedAtMs = state.sequenceStartedAtMs - puzzleId
        )
    }

    private fun matches(requirement: PuzzleRequirement, observation: Observation): Boolean {
        if (!observation.confidence.isFinite() || observation.confidence < requirement.minConfidence) return false
        if (observation.subject != requirement.subject || observation.predicate != requirement.predicate || observation.target != requirement.target) return false
        if (requirement.normalizedMargin != null) {
            val margin = observation.normalizedMargin
            if (margin == null || !margin.isFinite() || margin < requirement.normalizedMargin) return false
        }
        if (requirement.minimumOverlap != null) {
            val overlap = observation.overlap
            if (overlap == null || !overlap.isFinite() || overlap < requirement.minimumOverlap) return false
        }
        return true
    }

    private fun completeCamera(puzzleId: String, observation: Observation): List<PuzzleCompleted> {
        val committedSequence = state.stateSequence + 1
        val completion = CompletedPuzzle(
            puzzleId = puzzleId,
            path = CompletionPath.CAMERA,
            committedSequence = committedSequence,
            observationSequence = observation.sequence
        )
        state = state.copy(
            stateSequence = committedSequence,
            completedPuzzles = state.completedPuzzles + (puzzleId to completion),
            sequenceSteps = state.sequenceSteps - puzzleId,
            sequenceStartedAtMs = state.sequenceStartedAtMs - puzzleId
        )
        resetHold(puzzleId)
        return listOf(PuzzleCompleted(completion))
    }

    fun submit(
        requirements: List<PuzzleRequirement>,
        holdMs: Long,
        observation: Observation
    ): List<PuzzleCompleted> {
        require(requirements.isNotEmpty()) { "At least one authored requirement is required" }
        require(holdMs >= 0) { "Hold duration cannot be negative" }
        val puzzleId = observation.puzzleId
        if (puzzleId in state.completedPuzzles) return emptyList()
        if (observation.sessionId != sessionId || observation.calibrationVersion != calibrationVersion || observation.objectKitVersion != objectKitVersion) {
            resetPuzzle(puzzleId)
            return emptyList()
        }
        val lastSequence = state.lastObservationSequences[puzzleId] ?: -1
        if (observation.sequence <= lastSequence) return emptyList()
        state = state.copy(
            lastObservationSequences = state.lastObservationSequences + (puzzleId to observation.sequence)
        )

        if (!observation.calibrationValid || observation.needsReview || observation.occluded) {
            resetPuzzle(puzzleId)
            return emptyList()
        }

        val step = state.sequenceSteps[puzzleId] ?: 0
        if (step >= requirements.size) return emptyList()
        val holdKey = "$puzzleId/$step"
        if (!observation.candidatePresent) {
            val hold = holds[holdKey] ?: return emptyList()
            if (hold.missingFrames >= 1) {
                holds.remove(holdKey)
            } else {
                holds[holdKey] = hold.copy(missingFrames = 1)
            }
            return emptyList()
        }

        val requirement = requirements[step]
        if (!matches(requirement, observation)) {
            val matchesLaterStep = requirements.drop(step + 1).any { matches(it, observation) }
            resetPuzzle(puzzleId)
            if (!matchesLaterStep && requirements.size == 1) resetHold(puzzleId)
            return emptyList()
        }

        if (step > 0 && !noTimingMode) {
            val startedAt = state.sequenceStartedAtMs[puzzleId]
            val maxInterval = requirement.maxIntervalAfterPreviousMs
            if (startedAt != null && maxInterval != null && observation.observedAtMs - startedAt > maxInterval) {
                resetPuzzle(puzzleId)
                return emptyList()
            }
        }

        val previousHold = holds[holdKey]
        if (previousHold != null && observation.observedAtMs < previousHold.lastAtMs) {
            holds.remove(holdKey)
            return emptyList()
        }
        val hold = previousHold?.copy(lastAtMs = observation.observedAtMs, missingFrames = 0)
            ?: HoldState(startedAtMs = observation.observedAtMs, lastAtMs = observation.observedAtMs)
        holds[holdKey] = hold
        if (observation.observedAtMs - hold.startedAtMs < holdMs) return emptyList()

        if (step < requirements.lastIndex) {
            state = state.copy(
                sequenceSteps = state.sequenceSteps + (puzzleId to step + 1),
                sequenceStartedAtMs = state.sequenceStartedAtMs + (puzzleId to observation.observedAtMs)
            )
            resetHold(puzzleId)
            return emptyList()
        }
        return completeCamera(puzzleId, observation)
    }

    fun commitRemote(
        puzzleId: String,
        correctOptionIds: List<String>,
        selectedOptionIds: List<String>,
        expectedStateSequence: Long
    ): List<PuzzleCompleted> {
        if (puzzleId in state.completedPuzzles) return emptyList()
        require(expectedStateSequence == state.stateSequence) { "Stale remote fallback state sequence" }
        require(correctOptionIds.isNotEmpty()) { "An authored remote solution is required" }
        require(correctOptionIds.toSet().size == correctOptionIds.size) { "Duplicate authored remote solutions are invalid" }
        if (selectedOptionIds.size != correctOptionIds.size || selectedOptionIds.toSet() != correctOptionIds.toSet()) {
            return emptyList()
        }
        val committedSequence = state.stateSequence + 1
        val completion = CompletedPuzzle(puzzleId, CompletionPath.REMOTE, committedSequence)
        state = state.copy(
            stateSequence = committedSequence,
            completedPuzzles = state.completedPuzzles + (puzzleId to completion),
            sequenceSteps = state.sequenceSteps - puzzleId,
            sequenceStartedAtMs = state.sequenceStartedAtMs - puzzleId
        )
        resetPuzzle(puzzleId)
        return listOf(PuzzleCompleted(completion))
    }

    fun caseReport(): List<CompletedPuzzle> = state.completedPuzzles.values.sortedBy { it.committedSequence }
}
