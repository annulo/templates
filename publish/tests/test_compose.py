"""Shared feature composition, without contacting a platform or changing a project."""
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
import lib  # noqa: E402
import publish  # noqa: E402


class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.files = {'with-site/annulo.json': b'{}', 'creator/annulo.json': b'{}', 'blank/annulo.json': b'{}',
                      'core/components/ui.tsx': b'base', 'core/features/websites/local/audit.ts': b'website'}

    def test_feature_is_opt_in_and_preserves_published_paths(self):
        included = lib.compose('with-site/', {'features': ['websites']}, self.files, 'test')
        self.assertEqual(included['local/audit.ts'], b'website')
        self.assertFalse(any(p.startswith('features/') for p in included))
        self.assertNotIn('local/audit.ts', lib.compose('creator/', {}, self.files, 'test'))
        self.assertNotIn('components/ui.tsx', lib.compose('blank/', {'core': False}, self.files, 'test'))

    def test_feature_cannot_overwrite_template_file(self):
        self.files['with-site/local/audit.ts'] = b'custom'
        with self.assertRaises(SystemExit):
            lib.compose('with-site/', {'features': ['websites']}, self.files, 'test')

    def test_missing_and_invalid_features_are_rejected(self):
        for name in ['missing', '../websites']:
            with self.assertRaises(SystemExit):
                lib.compose('with-site/', {'features': [name]}, self.files, 'test')

    def test_messages_merge_by_key_and_reject_clashes(self):
        self.files['core/messages/en.json'] = b'{"a": {"x": "core"}}'
        self.files['creator/messages/en.json'] = b'{"a": {"y": "tpl"}}'
        merged = lib.compose('creator/', {}, self.files, 'test')['messages/en.json']
        self.assertIn(b'"x"', merged)
        self.assertIn(b'"y"', merged)
        self.files['creator/messages/en.json'] = b'{"a": {"x": "tpl"}}'
        with self.assertRaises(SystemExit):
            lib.compose('creator/', {}, self.files, 'test')

    def test_release_requires_the_template_changelog_and_a_higher_version(self):
        files = {'creator/changelog.yaml': b'- version: 0.14.0\n'}
        current = publish.current
        try:
            publish.current = lambda name: 'v0.13.1'
            publish.check_version(files, 'creator', 'v0.14.0')
            for bad in ['v0.13.1', 'v0.13.0', 'creator/v0.14.0', '0.14.0', 'v0.15.0']:
                with self.assertRaises(SystemExit):
                    publish.check_version(files, 'creator', bad)
            with self.assertRaises(SystemExit):
                publish.check_version(files, 'product', 'v0.14.0')
        finally:
            publish.current = current

if __name__ == '__main__':
    unittest.main()
