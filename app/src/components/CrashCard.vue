<template>
    <div class="border rounded p-2 mb-2">
        <div class="d-flex gap-2 align-items-start" role="button" @click="collapsed = !collapsed">
            <div class="flex-grow-1 small">
                <strong>{{ date.toLocaleString() }}</strong>
                &middot; {{ crash.version || crash.up_version || 'no version' }}
                <span v-if="crash.environment">&middot; {{ crash.environment }}</span>
                <span v-if="crash.platform">&middot; {{ crash.platform }}</span>
                &middot; {{ crash.script }} ({{ crash.line }})
                <span v-if="crash.uncaught" class="badge bg-danger">uncaught</span>
                <span v-else class="badge bg-warning text-dark">caught</span>
                <span v-if="crash.repeats" class="badge bg-secondary">&times;{{ crash.repeats }}</span>
            </div>
            <button class="btn btn-outline-danger btn-sm" @click.stop="deleteCrash">Delete</button>
        </div>
        <div v-if="!collapsed" class="row mt-2">
            <div class="col-md-6">
                <p v-if="crash.context" class="mb-1"><em>{{ crash.context }}</em></p>
                <pre class="small text-wrap">{{ crash.longMessage || crash.message }}</pre>
                <p v-if="crash.engine" class="small text-muted mb-1">engine {{ crash.engine }}</p>
                <button v-if="crash.os" class="btn btn-secondary btn-sm" @click="showOSInfo = !showOSInfo">
                    {{ showOSInfo ? 'Hide' : 'Show' }} OS info
                </button>
                <pre v-if="showOSInfo" class="small"><code>{{ osText }}</code></pre>
            </div>
            <div class="col-md-6">
                <table class="table table-sm table-hover table-striped">
                    <thead><tr><th>Stacktrace</th></tr></thead>
                    <tbody>
                        <tr v-for="(frame, i) in crash.stacktrace" :key="i"><td class="font-monospace small">{{ frame }}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script>
    export default {
        props: {
            crash: {
                type: Object,
                required: true,
            },
        },
        emits: ['crashDeleted'],
        data() {
            return {
                collapsed: true,
                date: new Date(this.crash.timestamp),
                showOSInfo: false
            };
        },
        computed: {
            // An object since crashes were sanitised; a JSON string in crashes stored before.
            osText() {
                let os = this.crash.os;
                if (typeof os === 'string') {
                    try { os = JSON.parse(os); } catch (e) { return os; }
                }
                return JSON.stringify(os, null, 2);
            },
        },
        methods: {
            deleteCrash() {
                if (confirm("Are you sure you want to delete this crash?")) {
                    this.$http.delete(`/api/crash/${this.crash._id}`).then(() => {
                        this.$emit('crashDeleted', this.crash);
                    });
                }
            },
        }
    }
</script>
