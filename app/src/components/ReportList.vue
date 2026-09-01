<template>
    <div>
        <div v-for="report in reports" :key="report._id" class="card">
            <report-card :report="report" @reportDeleted="removeReport" />
        </div>
        <div v-if="!reports.length" class="text-center">
            <p class="text-muted">{{ displayText }}</p>
        </div>
    </div>
</template>

<script>
import ReportCard from './ReportCard.vue';

export default {
    components: { ReportCard },
    data() {
        return {
            // Distinct from "none found", because the two look identical on screen and mean
            // opposite things -- an empty list is good news and a failed load is not.
            displayText: 'Loading...',
            reports: [],
        };
    },
    mounted() {
        this.getData();
    },
    methods: {
        getData() {
            // No auth handling here on purpose: the axios interceptor in auth.js attaches the
            // password and re-prompts on a 401 for every request in the app. See the note there
            // about why this stopped being per-component.
            this.$http.get('/api/report').then(
                (response) => {
                    this.reports = response.data;
                    this.displayText = 'No reports here!';
                },
                (error) => {
                    console.log(error);
                    this.displayText = 'Error loading reports';
                }
            );
        },
        removeReport(report) {
            const idx = this.reports.findIndex((r) => r._id === report._id);
            if (idx !== -1) this.reports.splice(idx, 1);
        },
    },
}
</script>
