<template>
    <div class="card">
        <button class="btn btn-warning fs-4 text-start" @click="collapsed = !collapsed">
            <strong>{{ report.reportedName || '???' }}</strong>
            <span class="fs-6"> reported by {{ report.reporterName || '???' }}</span>
        </button>
        <div class="card-body container" v-if="!collapsed">
            <div class="alert alert-secondary">
                <button class="btn btn-outline-danger btn-sm float-end" @click="deleteReport">Delete</button>
                <span class="fs-5">Slot {{ report.reportedSlot }}</span>
                <span v-if="report.game" class="badge bg-secondary ms-2">{{ report.game }}</span>
                <p class="fw-light mb-0">Reported {{ date.toLocaleString() }}</p>
                <p v-if="report.version" class="fw-light mb-0">{{ report.version }}</p>
                <p v-if="report.server" class="fw-light mb-0">Server {{ report.server }}</p>
            </div>

            <!-- The reported player's own lines, as the reporter saw them. This is the substance
                 of a report: a name with no words behind it cannot be acted on. -->
            <h6>What they said</h6>
            <table class="table table-sm table-striped">
                <tbody>
                    <tr v-for="(line, i) in report.lines" :key="i">
                        <td class="font-monospace">{{ line }}</td>
                    </tr>
                    <tr v-if="!report.lines || !report.lines.length">
                        <td class="text-muted">No chat lines were attached.</td>
                    </tr>
                </tbody>
            </table>

            <!-- On demand rather than by default. This identifies the person who complained,
                 which is what you need to spot a pattern of bad-faith reports and is not what you
                 need in order to read the report itself. -->
            <button class="btn btn-secondary btn-sm" @click="showReporter = !showReporter">
                {{ showReporter ? 'Hide' : 'Show' }} reporter details
            </button>
            <div v-if="showReporter" class="mt-2">
                <p class="mb-0 fw-light">Reporter uid: <code>{{ report.reporterUid || '(none)' }}</code></p>
                <p class="mb-0 fw-light">Reporter ip: <code>{{ report.reporterIp || '(none)' }}</code></p>
            </div>
        </div>
    </div>
</template>

<script>
    export default {
        props: {
            report: {
                type: Object,
                required: true,
            },
        },
        data() {
            return {
                collapsed: true,
                date: new Date(this.report.timestamp),
                showReporter: false,
            };
        },
        methods: {
            deleteReport() {
                if (confirm('Delete this report? This cannot be undone.')) {
                    this.$http.delete(`/api/report/${this.report._id}`).then(() => {
                        this.$emit('reportDeleted', this.report);
                    });
                }
            },
        },
    }
</script>
