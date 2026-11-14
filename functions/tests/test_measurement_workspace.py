"""Selective workspace contract, bounded reads and stable real cursor semantics."""
import base64
import copy
import json
import inspect
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firebase_admin import firestore as fs
from firebase_functions import https_fn
from google.api_core.datetime_helpers import DatetimeWithNanoseconds
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client, Query as NativeQuery
import measurement_api as api
from test_measurements import FakeDB, Ref, Snapshot, normalize_entry, observation


class PageQuery:
    def __init__(self, db, path, orders=(), maximum=None, predicates=(), start=None, end=None):
        self.db, self.path, self.orders, self.maximum = db, path, orders, maximum
        self.predicates, self.start, self.end = predicates, start, end

    def clone(self, **values):
        args = {key: getattr(self, key) for key in ('orders', 'maximum', 'predicates', 'start', 'end')}
        return PageQuery(self.db, self.path, **{**args, **values})

    def order_by(self, key, direction=None):
        return self.clone(orders=(*self.orders, (key, direction)))

    def limit(self, maximum):
        return self.clone(maximum=maximum)

    def where(self, key, op, value):
        return self.clone(predicates=(*self.predicates, (key, op, value)))

    def start_at(self, values):
        return self.clone(start=(values, True))

    def start_after(self, values):
        return self.clone(start=(values, False))

    def end_at(self, values):
        return self.clone(end=(values, True))

    @staticmethod
    def comparable(value):
        if isinstance(value, Ref):
            value = value.path
        if isinstance(value, datetime):
            value = value.rfc3339() if hasattr(value, 'rfc3339') else value.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        return (value is not None, str(value or ''))

    def stream(self, transaction=None):
        paths = [path for path in self.db.docs if path.startswith(self.path + '/') and path.count('/') == self.path.count('/') + 1]
        # Firestore order_by excludes records missing the ordered field.
        paths = [path for path in paths if all(key == '__name__' or key in self.db.docs[path] for key, _ in self.orders)]
        def field(path, key):
            return path if key == '__name__' else self.db.docs[path].get(key)
        for key, op, value in self.predicates:
            def selected(path):
                a, b = self.comparable(field(path, key)), self.comparable(value)
                return {'==': a == b, '>=': a >= b, '<=': a <= b}[op]
            paths = [path for path in paths if selected(path)]
        for key, direction in reversed(self.orders):
            paths.sort(key=lambda path: self.comparable(field(path, key)), reverse=direction == fs.Query.DESCENDING)
        descending = bool(self.orders and self.orders[0][1] == fs.Query.DESCENDING)
        def cursor_tuple(values):
            return tuple(self.comparable(values[key]) for key, _ in self.orders)
        def row_tuple(path):
            return tuple(self.comparable(field(path, key)) for key, _ in self.orders)
        if self.start:
            values, inclusive = self.start
            target = cursor_tuple(values)
            if descending:
                paths = [path for path in paths if (row_tuple(path) <= target if inclusive else row_tuple(path) < target)]
            else:
                paths = [path for path in paths if (row_tuple(path) >= target if inclusive else row_tuple(path) > target)]
        if self.end:
            target = cursor_tuple(self.end[0])
            paths = [path for path in paths if row_tuple(path) >= target] if descending else [path for path in paths if row_tuple(path) <= target]
        paths = paths[:self.maximum]
        self.db.queries.append({'path': self.path, 'limit': self.maximum, 'returned': len(paths), 'orders': self.orders, 'predicates': self.predicates})
        return iter(Snapshot(Ref(self.db, path)) for path in paths)

    def get(self):
        return list(self.stream())


class PageDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.queries = []

    def collection(self, path):
        return PageQuery(self, path)


class SelectiveWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.db = PageDB()
        self.db.docs['users/u/measurement_state/current'] = {'revision': 4}

    def call(self, data, uid='u'):
        request = SimpleNamespace(data=data)
        with patch.object(api, 'require_approved', return_value=uid), patch.object(api.fs, 'client', return_value=self.db):
            return inspect.unwrap(api.get_measurement_workspace)(request)

    def add(self, identifier, measured='2026-10-17', source='Scale A', unit='kg'):
        entry = normalize_entry(observation(measured_at=measured, source=source))
        entry['metrics'][0]['unit'] = unit
        self.db.docs['users/u/measurement_entries/' + identifier] = entry

    def test_125_canonical_entries_are_read_as_real_pages_without_whole_history(self):
        for index in range(125):
            self.add(f'e{index:03}', (date(2026,10,17) - timedelta(days=index // 3)).isoformat())
        found, cursor = [], None
        with patch.object(api, '_history', side_effect=AssertionError('Full history scan')), patch.object(api, '_factual_digest', side_effect=AssertionError('Digest read')):
            while True:
                page = self.call({'section':'history','pageSize':10, **({'cursor':cursor} if cursor else {})})
                self.assertLessEqual(len(page['entries']), 10)
                self.assertNotIn('factual_digest', page)
                found.extend(entry['id'] for entry in page['entries'])
                if not page['has_more']:
                    self.assertIsNone(page['next_cursor'])
                    break
                cursor = page['next_cursor']
                self.assertLess(len(found), 126)
        expected = sorted([path.rsplit('/',1)[1] for path in self.db.docs if '/measurement_entries/' in path],
            key=lambda identifier: (self.db.docs['users/u/measurement_entries/' + identifier]['measured_at'], identifier), reverse=True)
        self.assertEqual(found, expected)
        self.assertEqual(len(set(found)),125)
        self.assertTrue(all(query['limit'] == 11 and query['returned'] <= 11 for query in self.db.queries))
        self.assertFalse(any('/measurement_memory' in query['path'] or '/workout_sessions' in query['path'] for query in self.db.queries))

    def test_legacy_pages_keep_both_log_entries_and_deduplicate_mirrors_and_overrides(self):
        self.add('c','2026-10-16')
        self.db.docs['users/u/logs/2026-10-17'] = {'weight_kg':80, 'body_composition_report': {'weight_kg':79,'report_date':'2026-09-01'}}
        self.db.docs['users/u/logs/2026-10-15'] = {'weight_kg':78,'body_composition_report': {'weight_kg':77,'report_date':'2026-08-01','report_storage_path':'owned/report.pdf'}}
        self.db.docs['users/u/body_composition_reports/r'] = {'created_at':datetime(2026,10,15,tzinfo=timezone.utc),'report_date':'2026-08-01','storage_path':'owned/report.pdf','extracted_data':{'weight_kg':77}}
        self.db.docs['users/u/measurement_legacy_overrides/legacy_manual_2026-10-15'] = {'deleted':True}
        found, cursor = [], None
        for _ in range(10):
            page = self.call({'section':'history','pageSize':1, **({'cursor':cursor} if cursor else {})})
            found.extend(page['entries'])
            if not page['has_more']: break
            cursor = page['next_cursor']
        self.assertEqual({entry['id'] for entry in found}, {'c','legacy_manual_2026-10-17','legacy_log_report_2026-10-17','legacy_report_r'})
        self.assertEqual(len(found),4)
        report = next(entry for entry in found if entry['id'] == 'legacy_report_r')
        self.assertEqual(report['measured_at'],'2026-08-01')
        self.assertTrue(report['history_record_date'].startswith('2026-10-15'))

    def test_empty_legacy_batches_advance_without_unbounded_scans(self):
        for index in range(35):
            self.db.docs[f'users/u/logs/{(date(2026,10,17)-timedelta(days=index)).isoformat()}'] = {'notes':'No measurements'}
        page = self.call({'section':'history','pageSize':10})
        self.assertEqual(page['entries'], [])
        self.assertTrue(page['has_more'])
        self.assertTrue(all(query['returned'] <= 11 for query in self.db.queries))
        seen = {page['next_cursor']}
        for _ in range(5):
            page = self.call({'section':'history','pageSize':10,'cursor':page['next_cursor']})
            if not page['has_more']: break
            self.assertNotIn(page['next_cursor'],seen)
            seen.add(page['next_cursor'])
        self.assertFalse(page['has_more'])

    def test_invalid_stale_cross_user_and_cross_size_cursors_are_rejected(self):
        self.add('a'); self.add('b')
        cursor = self.call({'section':'history','pageSize':1})['next_cursor']
        for data, uid in [({'section':'history','pageSize':1,'cursor':'garbage'},'u'),
                          ({'section':'history','pageSize':1,'cursor':cursor},'other'),
                          ({'section':'history','pageSize':2,'cursor':cursor},'u'),
                          ({'section':'history','pageSize':1,'cursor':cursor,'days':90},'u'),
                          ({'section':'summary','cursor':cursor},'u')]:
            with self.subTest(data=data,uid=uid), self.assertRaises(https_fn.HttpsError): self.call(data,uid)
        self.db.docs['users/u/measurement_state/current']['revision'] = 5
        with self.assertRaises(https_fn.HttpsError): self.call({'section':'history','pageSize':1,'cursor':cursor})

    def test_sparse_legacy_branch_does_not_reorder_older_canonical_records(self):
        self.add('older','2026-01-01')
        for index in range(15):
            self.db.docs[f'users/u/logs/{(date(2026,10,17)-timedelta(days=index)).isoformat()}'] = {'notes':'No measurements'}
        self.db.docs['users/u/logs/2026-10-01'] = {'weight_kg':80}
        found, cursor = [], None
        for _ in range(5):
            page = self.call({'section':'history','pageSize':10, **({'cursor':cursor} if cursor else {})})
            found.extend(entry['id'] for entry in page['entries'])
            if not page['has_more']: break
            cursor = page['next_cursor']
        self.assertEqual(found,['legacy_manual_2026-10-01','older'])

    def test_legacy_reports_with_null_upload_dates_remain_pageable(self):
        for identifier in ('a','b','c'):
            self.db.docs[f'users/u/body_composition_reports/{identifier}'] = {'created_at':None,'extracted_data':{'weight_kg':80}}
        found, cursor = [], None
        for _ in range(5):
            page = self.call({'section':'history','pageSize':1, **({'cursor':cursor} if cursor else {})})
            found.extend(entry['id'] for entry in page['entries'])
            if not page['has_more']: break
            cursor = page['next_cursor']
        self.assertEqual(found,['legacy_report_c','legacy_report_b','legacy_report_a'])

    def test_trends_wait_for_metric_unit_and_source_and_only_return_selected_period(self):
        self.add('now','2026-10-17'); self.add('old','2025-01-01'); self.add('other','2026-10-16','Scale B'); self.add('other_unit','2026-10-15','Scale A','points')
        with patch.object(api,'local_today',return_value=date(2026,10,17)), patch.object(api,'_history',side_effect=AssertionError('Full history scan')):
            options = self.call({'section':'trends','days':90})
            self.assertEqual(options['entries'],[])
            self.assertEqual(options['source_options'],[])
            sources = self.call({'section':'trends','days':90,'metricKey':'weight_kg','metricUnit':'kg'})
            self.assertEqual(sources['entries'],[])
            self.assertEqual(len(sources['source_options']),2)
            selected = self.call({'section':'trends','days':90,'metricKey':'weight_kg','metricUnit':'kg','sourceName':'Scale A','method':'bia'})
        self.assertEqual([entry['id'] for entry in selected['entries']],['now'])
        self.assertNotIn('factual_digest',selected)
        canonical = [query for query in self.db.queries if query['path'].endswith('/measurement_entries')]
        self.assertTrue(all(query['predicates'] == (('measured_at','>=','2026-07-20'),('measured_at','<=','2026-10-17')) for query in canonical))
        self.assertTrue(all(query['returned'] == 3 for query in canonical))

    def test_jobs_are_standalone_and_bounded_and_summary_has_no_entries(self):
        for index in range(25):
            self.db.docs[f'users/u/measurement_jobs/j{index}'] = {'status':'failed','created_at':datetime(2026,10,1,tzinfo=timezone.utc)}
        with patch.object(api,'_history',side_effect=AssertionError('Full history scan')):
            result = self.call({'section':'jobs'})
        self.assertEqual(len(result['jobs']),20)
        self.assertEqual(len(self.db.queries),1)
        self.db.queries.clear()
        with patch.object(api,'_history',return_value=([],False)), patch.object(api,'_all_progress_sessions',return_value=([],False)), patch.object(api,'_factual_digest',return_value={'summary':'facts'}):
            summary = self.call({'section':'summary'})
        self.assertNotIn('entries',summary)
        self.assertNotIn('jobs',summary)
        self.assertFalse(any(query['path'].endswith('/measurement_jobs') for query in self.db.queries))

    def test_unitless_bmi_can_be_selected_without_weakening_other_filters(self):
        self.db.docs['users/u/measurement_entries/bmi'] = {'measured_at':'2026-10-17','source_name':'Scale A','method':'bia',
            'metrics':[{'key':'bmi','label':'BMI','unit':'','value':24.5}]}
        request = {'section':'trends','days':90,'metricKey':'bmi','metricUnit':'','sourceName':'Scale A','method':'bia'}
        with patch.object(api,'local_today',return_value=date(2026,10,17)):
            result = self.call(request)
            for key in ('metricKey','sourceName','method'):
                with self.subTest(filter=key), self.assertRaises(https_fn.HttpsError):
                    self.call({**request,key:''})
        self.assertEqual(len(result['entries']),1)
        self.assertEqual(result['entries'][0]['metrics'][0]['unit'],'')
        self.assertEqual(result['metric_options'],[{'key':'bmi','label':'BMI','unit':''}])

    def reference_entry(self, identifier, measured, key, value, unit='cm', source='Charlie', method='anthropometric'):
        self.db.docs['users/u/measurement_entries/' + identifier] = {'measured_at':measured, 'source_name':source, 'method':method,
            'metrics':[{'key':key,'label':key,'value':value,'unit':unit}]}

    def references(self, **filters):
        with patch.object(api,'local_today',return_value=date(2026,10,18)):
            return self.call({'section':'references', **filters})

    def test_references_read_latest_charlie_report_without_writing_or_workout_ai_reads(self):
        self.db.docs['users/u/body_composition_reports/charlie'] = {
            'created_at':datetime(2026,10,12,tzinfo=timezone.utc), 'report_date':'2026-10-10', 'source_app':'Charlie',
            'extracted_data':{'fat_method':'anthropometric','weight_kg':80,'body_fat_pct':18,
                'circumferences':{'relaxed_arm_cm':32,'tensed_arm_cm':35,'waist_cm':82,'thighs_cm':56,'calf_cm':38},
                'skinfolds':{'thigh_mm':14},'breadths':{'humerus_cm':7}}}
        self.db.docs['users/u/measurement_jobs/pending'] = {'status':'pending','created_at':datetime(2026,10,18,tzinfo=timezone.utc)}
        self.reference_entry('same-day','2026-10-18','waist_cm',99)
        before = copy.deepcopy(self.db.docs)
        with patch.object(api,'_all_progress_sessions',side_effect=AssertionError('Workout read')), \
                patch.object(api,'_sessions',side_effect=AssertionError('Workout read')), \
                patch.object(api,'_factual_digest',side_effect=AssertionError('Digest persistence')), \
                patch.object(api,'_narrative',side_effect=AssertionError('AI call')):
            result = self.references(sourceName='Manual',method='manual')
        values = {entry['metrics'][0]['key']:entry['metrics'][0]['value'] for entry in result['reference_entries']}
        self.assertEqual(values, {'weight_kg':80,'body_fat_pct':18,'relaxed_arm_cm':32,'tensed_arm_cm':35,'waist_cm':82,'thighs_cm':56,'calf_cm':38})
        self.assertTrue(all(entry['source_name'] == 'Charlie' and entry['measured_at'] == '2026-10-10' for entry in result['reference_entries']))
        self.assertEqual(self.db.docs,before)
        self.assertEqual(result['revision'],4)
        self.assertFalse(result['has_more'])
        self.assertNotIn('entries',result)
        self.assertFalse(any(query['path'].endswith('/workout_sessions') or query['path'].endswith('/measurement_jobs') for query in self.db.queries))
        self.assertFalse(any(query['path'].endswith('/measurement_memory') or query['path'].endswith('/measurement_legacy_overrides') for query in self.db.queries))
        bounded = [query for query in self.db.queries if query['path'].endswith(('/measurement_entries','/body_composition_reports','/logs'))]
        self.assertEqual(len(bounded),3)
        self.assertTrue(all(query['limit'] == api.MAX_FACTUAL_HISTORY + 1 for query in bounded))

    def test_references_keep_legacy_edits_deletions_and_mirror_deduplication(self):
        self.db.docs['users/u/logs/2026-10-15'] = {'measurements':{'waist_cm':90}}
        self.db.docs['users/u/measurement_legacy_overrides/legacy_manual_2026-10-15'] = {'deleted':True}
        self.db.docs['users/u/logs/2026-10-14'] = {'measurements':{'waist_cm':89}}
        self.reference_entry('legacy_manual_2026-10-14','2026-10-14','waist_cm',82,source='Corrected tape',method='manual')
        self.db.docs['users/u/logs/2026-10-13'] = {'body_composition_report':{
            'report_date':'2026-10-12','report_storage_path':'owned/charlie.pdf','circumferences':{'relaxed_arm_cm':33},'skinfolds':{'triceps_mm':12}}}
        self.db.docs['users/u/body_composition_reports/charlie'] = {
            'created_at':datetime(2026,10,13,tzinfo=timezone.utc), 'report_date':'2026-10-12', 'source_app':'Charlie',
            'storage_path':'owned/charlie.pdf','extracted_data':{'fat_method':'anthropometric','circumferences':{'relaxed_arm_cm':33}}}
        before = copy.deepcopy(self.db.docs)
        result = self.references()
        values = {entry['metrics'][0]['key']:entry for entry in result['reference_entries']}
        self.assertEqual(values['waist_cm']['metrics'][0]['value'],82)
        self.assertEqual(values['waist_cm']['source_name'],'Corrected tape')
        self.assertEqual(values['relaxed_arm_cm']['reference_source_ids'],['legacy_report_charlie'])
        self.assertEqual(values['relaxed_arm_cm']['reference_reading_count'],1)
        self.assertEqual(self.db.docs,before)
        self.assertFalse(any(query['path'].endswith('/measurement_memory') or query['path'].endswith('/measurement_legacy_overrides') for query in self.db.queries))

    def test_references_prefer_exact_source_and_method_and_aggregate_daily_repeats(self):
        self.reference_entry('manual-a','2026-09-01','waist_cm',80,source='Manual',method='manual')
        self.reference_entry('manual-b','2026-09-01','waist_cm',84,source=' manual ',method='MANUAL')
        self.reference_entry('wrong-method','2026-10-16','waist_cm',95,source='Manual',method='bia')
        self.reference_entry('charlie','2026-10-17','waist_cm',87)
        self.reference_entry('arm','2026-10-12','relaxed_arm_cm',33)
        result = self.references(sourceName='MANUAL',method=' manual ')
        references = {entry['metrics'][0]['key']:entry for entry in result['reference_entries']}
        waist = references['waist_cm']
        self.assertEqual(waist['metrics'][0]['value'],82)
        self.assertEqual(waist['measured_at'],'2026-09-01')
        self.assertEqual(waist['reference_reading_count'],2)
        self.assertEqual(waist['reference_source_ids'],['manual-a','manual-b'])
        self.assertEqual(waist['reference_aggregation'],'daily_median')
        self.assertEqual(references['relaxed_arm_cm']['source_name'],'Charlie')
        fallback = self.references()['reference_entries']
        self.assertEqual(next(entry for entry in fallback if entry['metrics'][0]['key'] == 'waist_cm')['metrics'][0]['value'],87)

    def test_references_respect_selected_date_excluded_entry_and_metric_unit_boundaries(self):
        self.reference_entry('old','2026-09-20','waist',82)
        self.reference_entry('exclude','2026-10-01','waist_cm',83)
        self.reference_entry('same-day','2026-10-02','waist_cm',84)
        self.reference_entry('later','2026-10-17','waist_cm',85)
        self.reference_entry('wrong-unit','2026-10-01','waist_cm',90,unit='mm')
        self.reference_entry('generic-arm','2026-10-01','arms_cm',36)
        self.reference_entry('skinfold','2026-10-01','thigh_mm',14,unit='mm')
        self.reference_entry('breadth','2026-10-01','femur_cm',9)
        self.reference_entry('thigh','2026-10-01','thighs',56)
        self.reference_entry('weight','2026-10-01','peso',80,unit='kg')
        self.reference_entry('fat','2026-10-01','body_fat',18,unit='%')
        self.reference_entry('fat-mass','2026-10-01','body_fat',14,unit='kg')
        result = self.references(beforeDate='2026-10-02',excludeEntryId='exclude')
        values = {entry['metrics'][0]['key']:entry['metrics'][0]['value'] for entry in result['reference_entries']}
        self.assertEqual(values,{'weight_kg':80,'body_fat_pct':18,'waist_cm':82,'thighs_cm':56})
        self.assertTrue(all(entry['measured_at'] < '2026-10-02' for entry in result['reference_entries']))

    def test_references_ignore_missing_invalid_future_dates_and_invalid_numbers(self):
        for identifier, measured, value in [('missing',None,31),('invalid','2026-02-30',32),('compact','20261017',33),
                ('future','2026-10-19',34),('today','2026-10-18',35),('infinite','2026-10-17',float('inf')),
                ('nan','2026-10-17',float('nan')),('negative','2026-10-17',-3),('boolean','2026-10-17',True),
                ('string','2026-10-17','36')]:
            self.reference_entry(identifier,measured,'relaxed_arm_cm',value)
        self.reference_entry('valid','2026-10-10','relaxed_arm_cm',30)
        result = self.references()
        self.assertEqual(len(result['reference_entries']),1)
        self.assertEqual(result['reference_entries'][0]['id'],'valid')
        self.assertEqual(result['reference_entries'][0]['metrics'][0]['value'],30)
        self.assertEqual(self.references(beforeDate='2026-10-01')['reference_entries'],[])

    def test_reference_history_boundaries_are_visible_and_filters_are_validated(self):
        self.reference_entry('old','2026-09-01','waist_cm',81)
        self.reference_entry('new-a','2026-10-16','arms_cm',32)
        self.reference_entry('new-b','2026-10-17','arms_cm',33)
        with patch.object(api,'MAX_FACTUAL_HISTORY',2):
            result = self.references()
        self.assertEqual(result['reference_entries'],[])
        self.assertTrue(result['has_more'])
        self.assertTrue(result['warnings'])
        invalid = [{'beforeDate':value} for value in (None,True,20261017,'2026-02-30','20261017','2026-10-19')]
        invalid += [{'sourceName':'Manual'},{'method':'manual'},{'sourceName':' ','method':'manual'},
                    {'sourceName':3,'method':'manual'},{'excludeEntryId':''},{'cursor':'invalid'}]
        for filters in invalid:
            with self.subTest(filters=filters), self.assertRaises(https_fn.HttpsError):
                self.references(**filters)

    def test_real_sdk_cursor_preserves_report_timestamp_nanos_and_owned_paths(self):
        native = Client(project='offline-test',credentials=AnonymousCredentials())
        stamp = DatetimeWithNanoseconds(2026,10,17,tzinfo=timezone.utc,nanosecond=123456789)
        positions = {'reports':{'id':'r','value':stamp.rfc3339(),'offset':0,'done':True}}
        cursor = base64.urlsafe_b64encode(json.dumps({'v':1,'section':'history','uid':api.stable_id('u'),'revision':4,'page_size':10,'positions':positions}).encode()).decode()
        queries = []
        def empty(query, **kwargs):
            queries.append(query._to_protobuf())
            return iter([])
        with patch.object(NativeQuery,'stream',empty):
            api._history_page('u',native,{'pageSize':10,'cursor':cursor},4)
        report = next(query for query in queries if query.from_[0].collection_id == 'body_composition_reports')
        self.assertEqual(report._pb.start_at.values[0].timestamp_value.nanos,123456789)
        self.assertTrue(report.start_at.values[1].reference_value.endswith('/users/u/body_composition_reports/r'))


if __name__ == '__main__':
    unittest.main()
